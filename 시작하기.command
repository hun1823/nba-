#!/bin/bash
cd "$(dirname "$0")" || exit 1
echo "NBA 화면을 열고 전체 자료를 갱신합니다. 부상 정보는 화면에서 5분마다 별도 조회합니다."
echo "자동 갱신을 사용하는 동안 이 터미널을 열어 두세요."
python3 serve.py --open --update
