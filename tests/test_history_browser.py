"""Integration tests use an isolated browser with a controlled clock and synthetic history."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from datetime import datetime, timedelta, timezone
import json, tempfile
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
Thread(target=server.serve_forever,daemon=True).start()
iso=lambda t:t.isoformat().replace('+00:00','Z')
try:
 with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page()
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.install(time=datetime(2026,10,30,12,tzinfo=timezone.utc))
  page.goto(f'http://127.0.0.1:{server.server_port}')
  assert '표본 부족' in page.locator('#calibrationStatus').inner_text()
  page.locator('#hcLine').fill('-3.5');page.locator('#ouLine').fill('225.5')
  page.locator('#oddHcH').fill('1.85');page.locator('#oddOver').fill('1.85')
  page.locator('#recordPrediction').click()
  assert '저장했습니다' in page.locator('#recordMessage').inner_text()
  read=lambda:page.evaluate("JSON.parse(localStorage.getItem('nbatoto_forecast_history_v2'))")
  records=read();original=json.loads(json.dumps(records[0]))
  assert len(records)==1 and original['lines']=={'margin':3.5,'total':225.5}
  assert original['odds']['home']==1.85 and original['teams']['home']['rotation']
  page.locator('#hcLine').fill('-9.5');page.locator('#recordPrediction').click()
  assert '최초 예측' in page.locator('#recordMessage').inner_text()
  assert read()[0]==original
  page.locator('[data-tab=history]').click()
  form=page.locator('#historyTable form').first
  form.locator('[name=awayScore]').fill('101');form.locator('[name=homeScore]').fill('110')
  form.locator('[name=regulation]').check();form.locator('button').click()
  assert '시작 전' in page.locator('#historyMessage').inner_text()
  assert read()[0]['result'] is None
  start=datetime.fromisoformat(original['start'].replace('Z','+00:00'))
  page.clock.set_fixed_time(start+timedelta(hours=4))
  form.locator('button').click()
  saved=read()[0]
  assert saved['result']['home']==110 and saved['raw']==original['raw'] and saved['applied']==original['applied']
  assert saved['lines']==original['lines'] and saved['savedAt']==original['savedAt']
  with page.expect_download() as dl:page.locator('#exportHistory').click()
  backup=Path(tmp)/'backup.json';dl.value.save_as(backup)
  assert json.loads(backup.read_text())['records'][0]==saved
  page.locator('#importHistory').set_input_files(str(backup))
  page.wait_for_function("document.querySelector('#historyMessage').textContent.includes('백업을 합쳤습니다')")
  assert len(read())==1
  # Old/completed games cannot be backfilled as pregame forecasts.
  page.locator('[data-tab=predict]').click();page.locator('#recordPrediction').click()
  assert '소급 저장하지 않습니다' in page.locator('#recordMessage').inner_text()
  # Synthetic history only: prove the full calibration UI path without fabricating production results.
  synthetic=[]
  for i in range(130):
   t=datetime(2025,1,1,12,tzinfo=timezone.utc)+timedelta(days=i)
   error=[-9,-6,-3,0,3,6,9][i%7]
   synthetic.append(dict(id=f'test-{i}',version=original['version'],signature=original['signature'],gameId=f'test-{i}',home='BOS',away='MIA',
    start=iso(t),savedAt=iso(t-timedelta(hours=1)),raw=dict(margin=0,total=190,sdMargin=12.5,sdTotal=18),
    lines=dict(margin=3.5,total=200.5),result=dict(home=110+error,away=100,basis='regulation',recordedAt=iso(t+timedelta(hours=4)))))
  page.evaluate("rows=>localStorage.setItem('nbatoto_forecast_history_v2',JSON.stringify(rows))",synthetic)
  page.reload();page.locator('[data-tab=predict]').click()
  assert page.locator('#calibrationStatus').inner_text().count('검증 통과')==2
  assert '학습 100 / 후속 검증 30' in page.locator('#calibrationStatus').inner_text()
  page.locator('#hcLine').fill('0');page.locator('#ouLine').fill('225.5')
  assert '→' in page.locator('#outHC').inner_text()
  # Changing model settings isolates incompatible history.
  page.locator('[data-tab=help]').click()
  page.locator('[data-s=hca]').fill('3');page.locator('[data-s=hca]').press('Tab')
  page.locator('[data-tab=predict]').click()
  assert page.locator('#calibrationStatus').inner_text().count('표본 부족')==2
  assert not errors,errors
  print('PASS: pregame-only immutable snapshots, independent results, backup merge, no backfill, calibration UI, settings isolation')
  browser.close()
finally: server.shutdown()
