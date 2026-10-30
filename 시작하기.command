#!/bin/bash
# 더블클릭하면 최신 데이터를 받고 화면을 엽니다.
cd "$(dirname "$0")"
echo "NBA 데이터 업데이트 중... (약 1분)"
python3 update_data.py
open index.html
