import sys, unittest, json
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_data import find_bref

class IdentityTests(unittest.TestCase):
 def test_different_first_names_never_match(self):
  self.assertIsNone(find_bref('Dillon Mitchell','BOS',{'davion mitchell': {'mitchda01'}}, {}))
 def test_reviewed_alias(self):
  self.assertEqual(find_bref('Ronald Holland II','DET',{'ron holland': {'hollaro01'}}, {}), 'hollaro01')
 def test_ambiguous_names_are_not_guessed(self):
  self.assertIsNone(find_bref('John Smith','BOS',{'john smith': {'a','b'}}, {}))
 def test_bundle_has_unique_ids_and_no_wrong_mitchell(self):
  source=(Path(__file__).resolve().parents[1]/'data/nba_data.js').read_text()
  data=json.loads(source.split('=',1)[1].strip().rstrip(';'))
  ids=[p['bref'] for p in data['players'] if p['bref']]
  self.assertEqual(len(ids),len(set(ids)))
  p=next(p for p in data['players'] if p['eid']=='5106283')
  self.assertIsNone(p['cur']);self.assertIsNone(p['prev'])

if __name__=='__main__':unittest.main()
