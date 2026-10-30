"""Run: python3 tests/test_browser.py (requires Playwright and Chromium)."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
try:
 with sync_playwright() as p:
  browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
  page = browser.new_page()
  errors = []
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}')
  page.wait_for_selector('#scenarioRows tr')
  assert not errors, errors
  assert '중복 통계 ID 0건' in page.locator('#dataQuality').inner_text()
  page.locator('#hcLine').fill('-3.5'); page.locator('#ouLine').fill('225.5')
  baseline = page.locator('#scenarioRows tr').nth(1).inner_text()
  inputs = page.locator('#rosterHome input[data-minutes]:not([disabled])')
  inputs.first.fill('20'); inputs.first.press('Tab')
  assert '240.0 / 240' in page.locator('#rosterHome .rotation-total').inner_text()
  assert baseline != page.locator('#scenarioRows tr').nth(1).inner_text()
  page.locator('#scenarioName').fill('제한 20분'); page.locator('#saveScenario').click()
  assert page.locator('#scenarioRows tr').count() == 3
  saved = page.locator('#scenarioRows tr').nth(2).inner_text()
  page.locator('#rosterHome input[data-minutes]:not([disabled])').first.fill('10')
  page.locator('#rosterHome input[data-minutes]:not([disabled])').first.press('Tab')
  assert saved == page.locator('#scenarioRows tr').nth(2).inner_text()
  page.reload(); page.wait_for_selector('#scenarioRows tr')
  assert page.locator('#scenarioRows tr').count() == 3
  original_home = page.locator('#homeSel').input_value()
  original_away = page.locator('#awaySel').input_value()
  alternate = next(x for x in page.locator('#homeSel option').evaluate_all('(xs)=>xs.map(x=>x.value)') if x not in [original_home, original_away])
  page.locator('#homeSel').select_option(alternate)
  assert page.locator('#scenarioRows tr').count() == 2
  assert page.locator('#rosterHome input[data-minutes]:not([disabled])').first.input_value() == ''
  # A whole-number line has separate equality mass and unresolved EV.
  page.locator('#hcLine').fill('0'); page.locator('#oddHcH').fill('1.85')
  assert '정산 선택' in page.locator('#outHC').inner_text()
  assert '같을 확률' in page.locator('#outHC').inner_text()
  page.locator('#settlement').select_option('refund')
  assert '정산 선택' not in page.locator('#outHC .bet').inner_text()
  # Infeasible fixed rotations must stop probabilities.
  for _ in range(7):
   empty = page.locator('#rosterHome input[data-minutes]:not([disabled])').filter()
   index = next(i for i in range(empty.count()) if empty.nth(i).input_value() == '')
   empty.nth(index).fill('40'); empty.nth(index).press('Tab')
  assert '예측 보류' in page.locator('#result').inner_text()
  assert '확인하세요' in page.locator('#outHC').inner_text()
  page.locator('#resetInj').click()
  assert '예측 보류' not in page.locator('#result').inner_text()
  # Same-team selection is rejected.
  page.locator('#awaySel').select_option(page.locator('#homeSel').input_value())
  assert '예측 보류' in page.locator('#result').inner_text()
  assert not errors, errors
  print('PASS: load, quality, minutes, scenarios, persistence, isolation, settlement, invalid rotations, same-team guard')
  browser.close()
finally:
 server.shutdown()
