"""ESPN injury feed with strict parsing and last-good snapshot preservation."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import urllib.request

URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries'


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def parse_feed(payload):
    if not isinstance(payload, dict) or payload.get('status') != 'success':
        raise ValueError('ESPN 응답 상태가 success가 아닙니다.')
    teams = payload.get('injuries')
    if not isinstance(teams, list) or not teams:
        raise ValueError('부상 명단이 비어 있거나 형식이 달라 기존 정보를 유지합니다.')
    timestamp = payload.get('timestamp')
    if not isinstance(timestamp, str):
        raise ValueError('원본 자료 시각이 없습니다.')
    parsed = dt.datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('원본 자료 시각에 시간대가 없습니다.')
    injuries = {}
    for team in teams:
        if not isinstance(team, dict) or not isinstance(team.get('injuries'), list):
            raise ValueError('부상 명단 일부의 형식이 잘못되었습니다.')
        for item in team['injuries']:
            athlete = item.get('athlete', {})
            eid = str(athlete.get('id', ''))
            if not eid.isdigit():
                for link in athlete.get('links', []):
                    match = re.search(r'/id/(\d+)(?:/|$)', link.get('href', ''))
                    if match:
                        eid = match.group(1)
                        break
            if not eid.isdigit() or not isinstance(item.get('status'), str) or not item['status']:
                raise ValueError('선수 ID 또는 부상 상태를 확인할 수 없습니다.')
            detail = item.get('details') or {}
            injury = {
                'status': item['status'], 'date': item.get('date', ''),
                'name': athlete.get('displayName', ''),
                'type': ' '.join(str(detail[k]) for k in ('side', 'type', 'detail') if detail.get(k)),
                'returnDate': detail.get('returnDate', ''), 'comment': item.get('shortComment', ''),
                'source': 'ESPN',
            }
            if eid not in injuries or injury['date'] > injuries[eid]['date']:
                injuries[eid] = injury
    if not injuries:
        raise ValueError('선수 정보가 없는 응답이어서 기존 정보를 유지합니다.')
    return {'source': 'ESPN', 'sourceUrl': URL, 'sourceUpdatedAt': timestamp, 'injuries': injuries}


def download_feed():
    req = urllib.request.Request(URL, headers={'User-Agent': 'nba-toto-helper/1.0 (personal stats script)',
                                               'Cache-Control': 'no-cache', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read(5_000_001)
    if len(raw) > 5_000_000:
        raise ValueError('예상보다 큰 부상 응답입니다.')
    return json.loads(raw.decode('utf-8'))


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=path.name+'.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class InjuryFeed:
    def __init__(self, path, downloader=download_feed, clock=time.monotonic):
        self.path, self.downloader, self.clock = Path(path), downloader, clock
        self.lock = threading.Lock()
        self.last_attempt = None
        self.state = {'status': 'unavailable', 'source': 'ESPN', 'sourceUrl': URL,
                      'fetchedAt': None, 'attemptedAt': None, 'snapshot': None}
        try:
            stored = json.loads(self.path.read_text(encoding='utf-8'))
            if stored.get('snapshot') and stored.get('fetchedAt'):
                self.state = stored
        except (OSError, ValueError, AttributeError):
            pass

    def get(self):
        with self.lock:
            return dict(self.state)

    def refresh(self):
        # One request per minute per server, including failures and multiple browser tabs.
        with self.lock:
            now = self.clock()
            if self.last_attempt is not None and now - self.last_attempt < 60:
                return {**self.state, 'retryAfter': max(1, int(60-(now-self.last_attempt)))}
            self.last_attempt = now
            attempted = utc_now()
            try:
                snapshot = parse_feed(self.downloader())
                previous = self.state.get('snapshot')
                if previous and dt.datetime.fromisoformat(snapshot['sourceUpdatedAt'].replace('Z', '+00:00')) < dt.datetime.fromisoformat(previous['sourceUpdatedAt'].replace('Z', '+00:00')):
                    raise ValueError('이전보다 오래된 원본 응답이어서 기존 정보를 유지합니다.')
                next_state = {'status': 'ok', 'source': 'ESPN', 'sourceUrl': URL,
                              'attemptedAt': attempted, 'fetchedAt': utc_now(), 'snapshot': snapshot}
                atomic_json(self.path, next_state)
                self.state = next_state
            except Exception as error:
                # No failed/empty response may clear the previous successful snapshot.
                self.state = {**self.state, 'status': 'error', 'attemptedAt': attempted,
                              'message': 'ESPN 조회 실패: ' + str(error)[:300]}
            return dict(self.state)
