import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from injury_feed import InjuryFeed, parse_feed


def fixture(eid='123', status='Out', timestamp='2026-10-30T10:00:00Z'):
    return {'status':'success','timestamp':timestamp,'injuries':[
        {'id':'2','injuries':[{'status':status,'date':'2026-10-30T09:30:00Z',
         'athlete':{'displayName':'Sample Player','links':[{'href':f'https://www.espn.com/nba/player/_/id/{eid}/sample'}]},
         'details':{'type':'Ankle','side':'Left'},'shortComment':'Test report'}]}]}


class InjuryTests(unittest.TestCase):
    def test_id_mapping_and_status(self):
        r=parse_feed(fixture())
        self.assertEqual(r['injuries']['123']['status'],'Out')
        self.assertEqual(r['injuries']['123']['type'],'Left Ankle')
        self.assertEqual(r['sourceUpdatedAt'],'2026-10-30T10:00:00Z')

    def test_bad_or_empty_payload_not_healthy(self):
        for data in [{}, {'status':'success','timestamp':'2026-10-30T10:00:00Z','injuries':[]},
                     {'status':'success','timestamp':'2026-10-30T10:00:00Z','injuries':[{'injuries':[{}]}]}]:
            with self.assertRaises((ValueError,KeyError)):parse_feed(data)

    def test_last_good_failure_rate_limit_and_recovery(self):
        ticks=[0];calls=[];response=[fixture()]
        def download():
            calls.append(1)
            if isinstance(response[0],Exception):raise response[0]
            return response[0]
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'snapshot.json'
            feed=InjuryFeed(path,download,lambda:ticks[0])
            good=feed.refresh(); self.assertEqual(good['status'],'ok')
            ticks[0]=10;self.assertIn('retryAfter',feed.refresh());self.assertEqual(len(calls),1)
            ticks[0]=61;response[0]=OSError('offline')
            bad=feed.refresh();self.assertEqual(bad['status'],'error')
            self.assertEqual(bad['snapshot'],good['snapshot']);self.assertEqual(bad['fetchedAt'],good['fetchedAt'])
            self.assertEqual(json.loads(path.read_text()),good)
            self.assertEqual(InjuryFeed(path).get()['snapshot'],good['snapshot'])
            ticks[0]=122;response[0]=fixture(status='Questionable',timestamp='2026-10-30T11:00:00Z')
            self.assertEqual(feed.refresh()['snapshot']['injuries']['123']['status'],'Questionable')
            ticks[0]=183;response[0]=fixture(timestamp='2026-10-29T11:00:00Z')
            stale=feed.refresh();self.assertEqual(stale['status'],'error')
            self.assertEqual(stale['snapshot']['injuries']['123']['status'],'Questionable')

    def test_atomic_storage_error_does_not_report_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'directory';path.mkdir()
            state=InjuryFeed(path,fixture).refresh()
            self.assertEqual(state['status'],'error')
            self.assertIsNone(state['snapshot'])

if __name__=='__main__':unittest.main()
