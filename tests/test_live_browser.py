"""Local API + browser test with fixture feed; no live external requests."""
from pathlib import Path
from threading import Thread
import json, sys, tempfile, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from injury_feed import InjuryFeed
from serve import make_server
from test_injury_feed import fixture

root=Path(__file__).resolve().parents[1]
data=json.loads((root/'data/nba_data.js').read_text().split('=',1)[1].strip().rstrip(';'))
player=next(p for p in data['players'] if p['team']=='BOS' and (p['cur'] or {}).get('mpg',0)>20 and not p['injury'])
with tempfile.TemporaryDirectory() as tmp:
 ticks=[0]; response=[fixture(player['eid'])]; calls=[]
 def downloader():
  calls.append(1)
  if isinstance(response[0],Exception):raise response[0]
  return response[0]
 feed=InjuryFeed(Path(tmp)/'live.json',downloader,lambda:ticks[0])
 server=make_server(0,feed)
 Thread(target=server.serve_forever,daemon=True).start()
 url=f'http://127.0.0.1:{server.server_port}'
 try:
  # Cross-origin pages cannot trigger refresh.
  request=urllib.request.Request(url+'/api/injuries/refresh',data=b'{}',headers={'Content-Type':'application/json','Origin':'https://example.com'})
  try:urllib.request.urlopen(request);raise AssertionError('cross origin allowed')
  except urllib.error.HTTPError as e:assert e.code==403
  assert not calls
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.add_init_script("localStorage.setItem('nbatoto_liveAuto','false')")
   page.goto(url)
   page.wait_for_function("!document.querySelector('#refreshInjuries').disabled")
   page.locator('#homeSel').select_option('BOS');page.locator('#awaySel').select_option('MIA')
   # Saved scenarios freeze resolved injury states, not changing feed defaults.
   page.locator('#scenarioName').fill('갱신 전');page.locator('#saveScenario').click()
   saved_scores=lambda:[page.locator('#scenarioRows tr').nth(2).locator('td').nth(i).inner_text().split('\n')[0] for i in (1,2,3)]
   saved=saved_scores()
   page.locator('#refreshInjuries').click()
   page.wait_for_function("document.querySelector('#injuryLiveStatus').textContent.includes('조회 성공')")
   checkbox=page.locator(f'#rosterHome input[data-eid="{player["eid"]}"]')
   assert checkbox.is_checked()
   assert saved_scores()==saved
   checkbox.uncheck() # explicit play override must survive a fresh Out report
   ticks[0]=61;response[0]=fixture(player['eid'],timestamp='2026-10-30T11:00:00Z')
   page.locator('#refreshInjuries').click()
   page.wait_for_function("!document.querySelector('#refreshInjuries').disabled")
   assert not checkbox.is_checked()
   assert '직접 포함' in checkbox.locator('xpath=ancestor::tr').inner_text()
   ticks[0]=122;response[0]=OSError('fixture offline')
   page.locator('#refreshInjuries').click()
   page.wait_for_function("document.querySelector('#injuryLiveStatus').textContent.includes('조회 실패')")
   assert '마지막 성공' in page.locator('#injuryLiveStatus').inner_text()
   assert not checkbox.is_checked()
   assert '결장' in checkbox.locator('xpath=ancestor::tr').inner_text()
   assert not errors,errors
   browser.close()
  print('PASS: live local API, ID matching, frozen scenarios, manual overrides, failure retention, origin restrictions')
 finally:server.shutdown();server.server_close()
