#!/usr/bin/env python3
"""NBA 데이터 업데이트 스크립트 (추가 설치 필요 없음).

- Basketball-Reference: 이번 시즌 / 지난 시즌 선수 기본·고급 통계, 팀 레이팅·페이스
- ESPN: 현재 로스터, 부상자 명단, 경기 일정과 배당 라인

결과는 data/nba_data.js (웹 화면용)와 data/*.csv (엑셀용)로 저장됩니다.
사용법: python3 update_data.py           (3시간 이내 받은 파일은 재사용)
        python3 update_data.py --force   (전부 새로 받기)
"""
import csv
import datetime as dt
import html
import json
import os
import re
import sys
import time
import tempfile
from injury_feed import download_feed, parse_feed, utc_now
import unicodedata
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
USER_AGENT = "nba-toto-helper/1.0 (personal stats script)"
CACHE_HOURS = 3
BREF_DELAY = 4.0  # Basketball-Reference는 분당 20회 제한이 있어 간격을 둡니다
FORCE = "--force" in sys.argv

# ESPN 약어 -> Basketball-Reference 약어
ESPN_TO_BREF = {"BKN": "BRK", "CHA": "CHO", "PHX": "PHO", "GS": "GSW", "NO": "NOP",
                "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}
BREF_TO_ESPN = {v: k for k, v in ESPN_TO_BREF.items()}

_last_bref = [0.0]


def fetch(url, cache_name, is_bref=False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if not FORCE and os.path.exists(path) and time.time() - os.path.getmtime(path) < CACHE_HOURS * 3600:
        with open(path, encoding="utf-8") as f:
            return f.read()
    if is_bref:
        wait = BREF_DELAY - (time.time() - _last_bref[0])
        if wait > 0:
            time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode("utf-8", errors="replace")
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last_err = e
        except Exception as e:  # 네트워크 일시 오류
            last_err = e
        time.sleep(3 * (attempt + 1))
    else:
        raise last_err
    if is_bref:
        _last_bref[0] = time.time()
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return text


# ---------------- Basketball-Reference 파싱 ----------------
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
CELL_RE = re.compile(r'<(td|th)([^>]*)data-stat="([a-z0-9_]+)"([^>]*)>(.*?)</\1>', re.S)
TAG_RE = re.compile(r"<[^>]+>")


def get_table(page, table_id):
    page = page.replace("<!--", "").replace("-->", "")  # 주석 안에 숨겨진 표도 읽기
    i = page.find('id="%s"' % table_id)
    if i < 0:
        return None
    j = page.find("</table>", i)
    return page[i:j]


def parse_rows(table):
    rows = []
    body_start = table.find("<tbody")
    for m in ROW_RE.finditer(table[body_start:] if body_start >= 0 else table):
        row = {}
        for cm in CELL_RE.finditer(m.group(1)):
            attrs = cm.group(2) + cm.group(4)
            stat, raw = cm.group(3), cm.group(5)
            row[stat] = html.unescape(TAG_RE.sub("", raw)).strip()
            pid = re.search(r'data-append-csv="([^"]+)"', attrs)
            if pid:
                row["_id"] = pid.group(1)
            href = re.search(r'''href=["']/teams/([A-Z0-9]{3})/''', raw)
            if href:
                row["_team"] = href.group(1)
        if row:
            rows.append(row)
    return rows


def num(v):
    if v is None:
        return None
    v = str(v).strip().replace(",", "")
    if v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


PER_GAME_FIELDS = {
    "g": "games", "gs": "games_started", "mpg": "mp_per_g", "fg": "fg_per_g", "fga": "fga_per_g",
    "fg_pct": "fg_pct", "fg3": "fg3_per_g", "fg3a": "fg3a_per_g", "fg3_pct": "fg3_pct",
    "ft": "ft_per_g", "fta": "fta_per_g", "ft_pct": "ft_pct", "efg_pct": "efg_pct",
    "orb": "orb_per_g", "drb": "drb_per_g", "trb": "trb_per_g", "ast": "ast_per_g",
    "stl": "stl_per_g", "blk": "blk_per_g", "tov": "tov_per_g", "pf": "pf_per_g", "pts": "pts_per_g",
}
ADV_FIELDS = {"mp": "mp", "per": "per", "ts_pct": "ts_pct", "usg_pct": "usg_pct", "obpm": "obpm",
              "dbpm": "dbpm", "bpm": "bpm", "vorp": "vorp", "ws": "ws", "ws48": "ws_per_48"}


def season_players(year):
    """시즌별 선수 통계. 여러 팀을 거친 선수는 합계(2TM 등) 행을 쓰고 마지막 소속팀을 기록."""
    out = {}
    pg = fetch("https://www.basketball-reference.com/leagues/NBA_%d_per_game.html" % year,
               "bref_%d_per_game.html" % year, True)
    adv = fetch("https://www.basketball-reference.com/leagues/NBA_%d_advanced.html" % year,
                "bref_%d_advanced.html" % year, True)
    for table_html, fields in ((get_table(pg, "per_game_stats"), PER_GAME_FIELDS),
                               (get_table(adv, "advanced"), ADV_FIELDS)):
        if not table_html:
            continue
        for r in parse_rows(table_html):
            pid = r.get("_id")
            if not pid:
                continue
            team = r.get("team_name_abbr", "")
            p = out.get(pid)
            if p is None:
                p = out[pid] = {"id": pid, "name": r.get("name_display", "").replace("*", ""),
                                "age": num(r.get("age")), "pos": r.get("pos", ""),
                                "team": team, "_total_done": set()}
            elif not re.match(r"\d+TM", team):
                p["team"] = team  # 이적 선수: 마지막 팀 행이 최근 소속팀
            key = id(fields)
            if key in p["_total_done"]:
                continue  # 이미 합계 행을 읽음 (팀별 행은 건너뜀)
            p["_total_done"].add(key)
            for k, src in fields.items():
                p[k] = num(r.get(src))
    for p in out.values():
        p.pop("_total_done", None)
    return out


def season_teams(year):
    page = fetch("https://www.basketball-reference.com/leagues/NBA_%d.html" % year,
                 "bref_%d_league.html" % year, True)
    teams, league = {}, {}
    adv = get_table(page, "advanced-team")
    if adv:
        for r in parse_rows(adv):
            d = {k: num(r.get(k)) for k in ("wins", "losses", "mov", "off_rtg", "def_rtg",
                                             "net_rtg", "pace", "srs", "efg_pct", "ts_pct")}
            if r.get("_team"):
                d["name"] = r.get("team", "").replace("*", "")
                teams[r["_team"]] = d
            elif "League" in r.get("team", ""):
                league = d
    for tid, prefix in (("per_game-team", ""), ("per_game-opponent", "opp_")):
        t = get_table(page, tid)
        if not t:
            continue
        for r in parse_rows(t):
            pts = num(r.get("opp_pts" if prefix else "pts", r.get("pts")))
            if r.get("_team") in teams:
                teams[r["_team"]][prefix + "ppg"] = pts
            elif "League" in r.get("team", ""):
                league[prefix + "ppg"] = pts
    if league.get("off_rtg") is None and teams:  # 리그 평균 행이 없으면 직접 계산
        for k in ("off_rtg", "pace", "ppg"):
            vals = [t[k] for t in teams.values() if t.get(k) is not None]
            league[k] = sum(vals) / len(vals) if vals else None
    return teams, league


# ---------------- ESPN ----------------
def espn_json(url, cache_name):
    return json.loads(fetch(url, cache_name))


def norm_name(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z ]", "", s.replace("-", " "))
    parts = [w for w in s.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v")]
    return " ".join(parts)


def espn_id_from_links(athlete):
    for l in athlete.get("links", []) or []:
        m = re.search(r"/id/(\d+)", l.get("href", ""))
        if m:
            return m.group(1)
    return athlete.get("id")


def find_bref(name, team, by_name, cur):
    # Only exact normalized names or reviewed aliases may link identities.
    aliases = {"ronald holland": "ron holland"}
    n = norm_name(name)
    ids = by_name.get(aliases.get(n, n), set())
    if len(ids) == 1:
        return next(iter(ids))
    candidates = [pid for pid in ids if cur.get(pid, {}).get("team") == team]
    return candidates[0] if len(candidates) == 1 else None


def main():
    today = dt.date.today()
    cur_year = today.year + 1 if today.month >= 8 else today.year  # 2026-27 시즌 = 2027
    prev_year = cur_year - 1
    label = lambda y: "%d-%02d" % (y - 1, y % 100)
    print("시즌: 이번 %s / 지난 %s" % (label(cur_year), label(prev_year)))

    seasons = {}
    for y in (cur_year, prev_year):
        try:
            print("  Basketball-Reference %s 받는 중..." % label(y))
            players = season_players(y)
            teams, league = season_teams(y)
            seasons[str(y)] = {"label": label(y), "players": players, "teams": teams, "league": league}
            print("    선수 %d명, 팀 %d개" % (len(players), len(teams)))
        except urllib.error.HTTPError as e:
            print("    %s 시즌 데이터 없음 (HTTP %s) - 건너뜀" % (label(y), e.code))

    print("  ESPN 팀/로스터 받는 중...")
    tj = espn_json("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams", "espn_teams.json")
    espn_teams = [t["team"] for t in tj["sports"][0]["leagues"][0]["teams"]]
    teams_out, rosters = {}, {}
    for t in espn_teams:
        ab = t["abbreviation"]
        bref = ESPN_TO_BREF.get(ab, ab)
        teams_out[bref] = {"abbr": bref, "espn": ab, "name": t["displayName"],
                           "short": t.get("shortDisplayName", t["name"]),
                           "color": "#" + t.get("color", "777777")}
        rj = espn_json("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/%s/roster" % t["id"],
                       "espn_roster_%s.json" % ab)
        rosters[bref] = rj.get("athletes", [])
        time.sleep(0.2)

    print("  ESPN 부상자 명단 받는 중...")
    # Injury reports are time-sensitive: never reuse the 3-hour statistics cache.
    injury_snapshot = parse_feed(download_feed())
    injuries = injury_snapshot['injuries']
    injuries_fetched_at = utc_now()

    # ---- 로스터와 통계 연결 ----
    cur = seasons.get(str(cur_year), {}).get("players", {})
    prev = seasons.get(str(prev_year), {}).get("players", {})
    by_name = {}
    for src in (prev, cur):
        for pid, p in src.items():
            by_name.setdefault(norm_name(p["name"]), set()).add(pid)


    STAT_KEYS = list(PER_GAME_FIELDS) + list(ADV_FIELDS)
    players_out, unmatched = [], []
    for team, athletes in rosters.items():
        for a in athletes:
            eid = str(a.get("id"))
            name = a.get("displayName") or a.get("fullName")
            pid = find_bref(name, team, by_name, cur)
            c, p = cur.get(pid) if pid else None, prev.get(pid) if pid else None
            if not pid:
                unmatched.append("%s(%s)" % (name, team))
            inj = injuries.get(eid)
            players_out.append({
                "eid": eid, "bref": pid, "name": name, "team": team,
                "pos": (a.get("position") or {}).get("abbreviation", "") or (c or p or {}).get("pos", ""),
                "jersey": a.get("jersey", ""), "age": a.get("age"),
                "height": a.get("displayHeight", ""),
                "cur": {k: c.get(k) for k in STAT_KEYS} if c else None,
                "prev": {k: p.get(k) for k in STAT_KEYS} if p else None,
                "prevTeam": p.get("team") if p else None,
                "injury": inj,
            })

    # ---- 경기 일정 (미국 날짜 기준 어제~3일 뒤) ----
    print("  ESPN 경기 일정 받는 중...")
    games = []
    for off in range(-1, 4):
        d = (today + dt.timedelta(days=off)).strftime("%Y%m%d")
        try:
            sj = espn_json("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=" + d,
                           "espn_scoreboard_%s.json" % d)
        except Exception as e:
            print("    %s 일정 실패: %s" % (d, e))
            continue
        for ev in sj.get("events", []):
            comp = ev["competitions"][0]
            side = {}
            for c in comp["competitors"]:
                ab = c["team"]["abbreviation"]
                side[c["homeAway"]] = {"team": ESPN_TO_BREF.get(ab, ab), "score": num(c.get("score")),
                                       "record": (c.get("records") or [{}])[0].get("summary", "")}
            if "home" not in side or "away" not in side:
                continue
            odds = (comp.get("odds") or [None])[0]
            line = None
            if odds:
                details = odds.get("details", "") or ""
                home_line = None
                m = re.match(r"([A-Z]+)\s+([-+]?\d+(?:\.\d+)?)", details)
                if m:
                    fav = ESPN_TO_BREF.get(m.group(1), m.group(1))
                    v = abs(float(m.group(2)))
                    home_line = -v if fav == side["home"]["team"] else v
                elif "EVEN" in details.upper():
                    home_line = 0.0
                ml = odds.get("moneyline") or {}

                def ml_odds(k):
                    try:
                        return ml[k]["close"]["odds"]
                    except (KeyError, TypeError):
                        return None
                line = {"provider": (odds.get("provider") or {}).get("name", ""), "details": details,
                        "homeSpread": home_line, "total": odds.get("overUnder"),
                        "homeML": ml_odds("home"), "awayML": ml_odds("away")}
            games.append({"id": ev["id"], "date": ev["date"], "name": ev.get("shortName", ""),
                          "state": ev["status"]["type"]["state"], "statusText": ev["status"]["type"].get("shortDetail", ""),
                          "home": side["home"], "away": side["away"], "line": line})
        time.sleep(0.2)
    seen, games_u = set(), []
    for g in sorted(games, key=lambda g: g["date"]):
        if g["id"] not in seen:
            seen.add(g["id"])
            games_u.append(g)

    team_stats = {}
    for y, s in seasons.items():
        team_stats[y] = {"label": s["label"], "teams": s["teams"], "league": s["league"]}

    payload = {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "curSeason": str(cur_year), "prevSeason": str(prev_year),
        "seasonLabels": {str(cur_year): label(cur_year), str(prev_year): label(prev_year)},
        "injuryMeta": {"source": "ESPN", "fetchedAt": injuries_fetched_at, "sourceUpdatedAt": injury_snapshot["sourceUpdatedAt"]},
        "teams": teams_out, "teamStats": team_stats, "players": players_out, "games": games_u,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    # The local server must never serve a half-written JavaScript payload.
    fd, temporary = tempfile.mkstemp(prefix='nba_data.', suffix='.tmp', dir=DATA_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write('window.NBA_DATA = ')
            json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
            f.write(';\n')
        os.replace(temporary, os.path.join(DATA_DIR, 'nba_data.js'))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

    # ---- 엑셀용 CSV ----
    cols = [("선수", "name"), ("팀", "team"), ("포지션", "pos"), ("경기", "g"), ("출전시간", "mpg"),
            ("득점", "pts"), ("리바운드", "trb"), ("어시스트", "ast"), ("스틸", "stl"), ("블록", "blk"),
            ("턴오버", "tov"), ("야투율", "fg_pct"), ("3점슛%", "fg3_pct"), ("자유투%", "ft_pct"),
            ("TS%", "ts_pct"), ("USG%", "usg_pct"), ("BPM", "bpm"), ("부상상태", "inj")]
    for which in ("cur", "prev"):
        y = cur_year if which == "cur" else prev_year
        path = os.path.join(DATA_DIR, "선수통계_%s.csv" % label(y))
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow([c[0] for c in cols])
            for p in sorted(players_out, key=lambda p: (p["team"], -((p[which] or {}).get("pts") or 0))):
                s = p[which] or {}
                row = []
                for _, k in cols:
                    if k in ("name", "team", "pos"):
                        row.append(p[k])
                    elif k == "inj":
                        row.append((p["injury"] or {}).get("status", ""))
                    else:
                        row.append("" if s.get(k) is None else s.get(k))
                w.writerow(row)

    matched = sum(1 for p in players_out if p["bref"])
    print("\n완료: 선수 %d명 (통계 연결 %d명), 부상자 %d명, 경기 %d개" %
          (len(players_out), matched, sum(1 for p in players_out if p["injury"]), len(games_u)))
    if unmatched:
        print("통계 없는 선수(신인/이름 불일치 등) %d명: %s" % (len(unmatched), ", ".join(unmatched[:25]) +
                                                      (" ..." if len(unmatched) > 25 else "")))
    print("저장 위치: %s" % DATA_DIR)


if __name__ == "__main__":
    main()
