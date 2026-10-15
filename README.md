# K-Factory-Copilot
Web Admin Dashboard &amp; iPad Operator App 기반 제조 운영 AI Copilot

K-Factory Copilot은 자동화 공장 운영자가 장비 이상 징후를 빠르게 파악하고, AI Advisor가 원인 후보와 조치 방안을 자연어로 설명해주는 제조 운영 AI Copilot입니다.

이 프로젝트의 목표는 실제 공장 시스템을 완전히 대체하는 것이 아니라, 센서 이상 탐지 결과를 운영자가 이해 가능한 원인 후보와 조치 설명으로 바꾸는 구조를 구현하는 것입니다.

1. Project Overview

K-Factory Copilot은 다음 흐름을 중심으로 동작합니다.

정상 운전
→ Scenario Injector로 고장 시나리오 주입
→ 센서 데이터 패턴 변화
→ Isolation Forest 기반 이상 탐지
→ Sensor Delta Module이 센서별 변화율 계산
→ Rule/Profile Engine이 원인 후보 생성
→ Web Dashboard / iPad App에서 이상 장비 하이라이트
→ 운영자가 AI Advisor에 자연어 질문
→ 로컬 LLM이 원인 후보와 조치 방안 설명

핵심 원칙은 다음입니다.

LLM은 판단자가 아니라 설명자입니다.

LLM이 원인을 직접 추론하지 않습니다.
Backend의 Rule/Profile Engine이 먼저 cause_candidates JSON을 생성하고, AI Advisor는 이 JSON을 운영자가 이해하기 쉬운 자연어로 설명합니다.

2. Why This Project Exists

기존 MES / SCADA / 공장 모니터링 시스템은 강력하지만, 다음 한계가 있습니다.

- 구축 비용이 높다
- 전문가 의존도가 크다
- 벤더 종속성이 강하다
- AI 기능이 모니터링 수준에 머무르는 경우가 많다
- 자연어 기반 설명 인터페이스가 부족하다
- 특정 공장/장비에 맞춘 커스텀 개발이 많다

K-Factory Copilot은 이러한 문제를 다음 방식으로 접근합니다.

- 로컬 우선 개발
- 오픈소스 기반 구성
- 공장 프로파일 JSON 기반 구조
- 설명 가능한 Rule Engine
- 로컬 LLM 기반 AI Advisor
- Web Admin Dashboard + iPad Operator App 분리
3. System Architecture
[Web Admin Dashboard]
React / TypeScript
React Flow
Scenario Injector
Ruleset Management
Evaluation Dashboard
Event History
        ↓
[Spring Auth Gateway]
Spring Boot
Spring Security
WebClient
JWT / Role-based Access Control
        ↓
[FastAPI Core API]
Factory Simulator
Sensor Delta Module
Isolation Forest
Rule/Profile Engine
Event Store
AI Advisor API
Voice STT API
        ↑
[iPad Operator App]
React Native / Expo / TypeScript
Factory Tablet Dashboard
AI Advisor
Voice Input
Event Timeline
4. Repository Structure

This repository is organized as a monorepo.

k-factory-copilot/
├─ README.md
├─ contracts/
│  ├─ api/
│  │  ├─ openapi.yaml
│  │  └─ websocket-events.md
│  └─ schemas/
│     ├─ factory_profile.schema.json
│     ├─ ruleset.schema.json
│     ├─ sensor_event.schema.json
│     ├─ sensor_delta.schema.json
│     ├─ cause_candidates.schema.json
│     ├─ advisor_request.schema.json
│     └─ advisor_response.schema.json
│
├─ backend/
│  ├─ core-api/
│  │  ├─ app/
│  │  ├─ tests/
│  │  └─ README.md
│  └─ auth-gateway/
│     ├─ src/
│     └─ README.md
│
├─ ai/
│  ├─ advisor/
│  │  ├─ prompts/
│  │  ├─ schemas/
│  │  ├─ model_configs/
│  │  └─ service/
│  ├─ voice/
│  │  └─ stt/
│  └─ evaluation/
│     ├─ evals/
│     ├─ runners/
│     └─ langfuse/
│
├─ frontend/
│  ├─ web-admin/
│  └─ ipad-operator/
│
├─ examples/
│  ├─ bearing_wear/
│  ├─ nozzle_clog/
│  └─ motor_overload/
│
├─ infra/
│  ├─ docker-compose.yml
│  └─ env.example
│
├─ docs/
│  ├─ architecture.md
│  ├─ development-workflow.md
│  ├─ api-contract.md
│  ├─ ai-advisor.md
│  ├─ evaluation.md
│  └─ decisions/
│
└─ scripts/
5. Responsibility Boundaries

이 프로젝트는 AI / Backend / Frontend의 책임을 명확하게 나눕니다.

Backend

Backend는 판단 구조와 데이터의 원천을 담당합니다.

Backend responsibilities:
- Factory Simulator
- Scenario Injector API
- Sensor Event 생성
- Isolation Forest 이상 탐지
- Sensor Delta 계산
- Rule/Profile Engine
- cause_candidates 생성
- Event Store 저장
- PostgreSQL / Neon DB 접근
- WebSocket 실시간 이벤트 송신
- Auth Gateway

원칙:

Backend는 원인 후보를 만든다.
AI는 원인 후보를 새로 만들지 않는다.
Frontend는 원인 후보를 계산하지 않는다.
AI

AI는 설명, 음성, 평가를 담당합니다.

AI responsibilities:
- LLM Advisor 프롬프트
- Ollama / Qwen / Mistral 모델 설정
- structured output schema
- cause_candidates 자연어 설명
- SOP / Runbook 연결
- STT 처리
- whisper.cpp / faster-whisper 설정
- LLM 응답 평가
- Langfuse / pytest eval set

원칙:

AI는 cause_candidates에 없는 원인을 추가하지 않는다.
AI는 evidence에 없는 센서 근거를 만들지 않는다.
AI는 recommended_actions를 과장하지 않는다.
AI는 설명자다.
Frontend

Frontend는 사용자 경험과 시각화를 담당합니다.

Frontend responsibilities:
- Web Admin Dashboard
- iPad Operator App
- Factory Map 표시
- Dependency Map 표시
- Event Timeline 표시
- AI Advisor UI
- Voice Input UI
- Scenario Injector UI
- Evaluation Dashboard UI
- 권한에 따른 화면 제한

Frontend가 하지 않는 것:

- 센서 이상 판단
- 원인 후보 계산
- Rule Engine 로직 구현
- LLM 응답 생성
- DB 직접 접근
Contracts

contracts/는 세 영역이 모두 지켜야 하는 공통 약속입니다.

Contracts responsibilities:
- API contract
- JSON Schema
- WebSocket event format
- Advisor request / response schema
- cause_candidates schema

기준:

Backend = 판단한다
AI = 설명한다
Frontend = 보여주고 입력받는다
Contracts = 모두가 지켜야 할 약속이다
6. Core Components
Factory Simulator

factory_profile.json을 기반으로 가상의 공장 센서 데이터를 생성합니다.

- 정상 신호 생성
- 고장 시나리오에 따른 열화 신호 생성
- 센서 간 상관관계 표현
- time_scale 지원
Isolation Forest

장비가 평소와 다른 상태인지 감지합니다.

- 비지도 학습 기반 이상 탐지
- 이상 여부 판단
- 원인 설명은 직접 하지 않음
Sensor Delta Module

정상 기준선과 최근 센서 값을 비교해 변화율을 계산합니다.

{
  "equipment_id": "robot_03",
  "sensor_deltas": {
    "vibration": {
      "change_pct": 43.3,
      "trend": "increase"
    },
    "current": {
      "change_pct": 18.8,
      "trend": "increase"
    },
    "temperature": {
      "change_pct": 12.4,
      "trend": "delayed_increase"
    }
  }
}
Rule/Profile Engine

ruleset.json을 기반으로 원인 후보를 생성합니다.

{
  "equipment_id": "robot_03",
  "anomaly_score": 0.91,
  "abnormal_sensors": ["vibration", "current", "temperature"],
  "cause_candidates": [
    {
      "cause": "bearing_wear",
      "confidence": 0.78,
      "evidence": [
        "vibration increased by 43%",
        "motor current increased by 19%",
        "temperature rose after vibration increase"
      ],
      "recommended_actions": [
        "inspect bearing housing",
        "reduce line speed",
        "schedule maintenance within 24 hours"
      ]
    }
  ]
}
AI Advisor

Backend가 생성한 cause_candidates를 운영자용 설명으로 변환합니다.

{
  "summary": "Robot 03에서 베어링 마모 가능성이 가장 높습니다.",
  "primary_cause": "bearing_wear",
  "confidence": 0.78,
  "evidence_explanation": [
    "진동이 기준 대비 43% 증가했습니다.",
    "모터 전류가 기준 대비 19% 증가했습니다.",
    "온도 상승이 진동 상승 이후 지연되어 나타났습니다."
  ],
  "recommended_actions": [
    "베어링 하우징을 점검합니다.",
    "라인 속도를 일시적으로 낮춥니다.",
    "24시간 이내 정비 일정을 잡습니다."
  ],
  "uncertainty": "공유 냉각 라인 이상은 아직 확인되지 않았습니다."
}
7. Client Applications
Web Admin Dashboard

관리자, 개발자, 발표자용 웹 대시보드입니다.

주요 기능:
- Factory Map
- Dependency Map
- Scenario Injector
- Ruleset Management
- Event History
- AI Advisor Test Panel
- Evaluation Dashboard

웹은 관리, 설정, 분석, 데모 제어에 집중합니다.

iPad Operator App

현장 운영자용 iPad 태블릿 앱입니다.

주요 기능:
- 장비 상태 확인
- 이상 장비 하이라이트
- 센서 변화율 확인
- AI Advisor 질문
- 음성 질문 입력
- 조치 방안 확인
- 정비 메모 작성
- 이벤트 타임라인 확인

iPad 앱은 운영자가 현장에서 빠르게 상황을 이해하고 조치 후보를 확인하는 데 집중합니다.

8. Voice Input

초기 음성 기능은 Push-to-Talk 방식으로 구현합니다.

iPad App
→ expo-audio로 녹음
→ FastAPI /voice/transcribe
→ whisper.cpp 또는 faster-whisper
→ transcript 반환
→ 사용자가 확인
→ /advisor/chat으로 전송

주의사항:

음성 명령으로 위험한 조치를 바로 실행하지 않는다.

다음 기능은 반드시 권한 확인과 확인 모달이 필요합니다.

- 시나리오 주입
- baseline reset
- 정비 완료 처리
- ruleset 변경
9. Evaluation

K-Factory Copilot은 LLM 응답을 감으로 판단하지 않습니다.

평가 기준:

- JSON schema 준수 여부
- cause_candidates 외 원인 생성 여부
- evidence 외 근거 생성 여부
- recommended_actions 과장 여부
- 한국어 설명 명확성
- 응답 지연 시간

평가 데이터 구조:

ai/evaluation/evals/
├─ bearing_wear/
│  ├─ input.json
│  ├─ expected.json
│  └─ checks.yaml
├─ nozzle_clog/
├─ motor_overload/
├─ cooling_line_degradation/
└─ power_instability/

목표:

LLM을 붙인 것이 아니라,
LLM이 근거를 벗어나지 않는지 평가 가능한 구조를 만든다.
10. Demo Scenario

대표 데모는 로봇 03 bearing_wear입니다. 아래 스크립트는 현재 Web Admin 화면 흐름 기준이며, 이후 작업의 회귀 검수 기준선입니다. 지도는 `/lab/plant`와 같은 라인 전체 3D 장면이고(설비 34대, 프로필에서 생성), 7번 아래에 센서 경보·원인 미상·훈련 모드·문제 보고 데모가 이어집니다.

실행 방법

cd frontend/web-admin
npm install        (처음 한 번만)
npm run dev
→ http://localhost:3000 열기

- 주입 이력은 브라우저 localStorage에 저장되어 새로고침해도 남습니다.
- 이력 없이 깨끗한 상태로 시연하려면 시크릿 창으로 여세요.

데모 스크립트와 기대 결과

1. 시작 화면
   - 왼쪽 탭 카드: 지도 · 장비 · 이벤트 · 설명 · 주입 · 이력 · 훈련 (지도 활성)
   - Top: 라인 A, 정상 28 · 주의 0 · 이상 0 · 센서 없음 6 (컨베이어를 뺀 34대, 센서가 없는 랙·지그·격리함 6대는 정상에 넣지 않고 따로 표시), 범례 주의 ≥ 0.5 · 이상 ≥ 0.7, 실시간 시계, 문제 보고 버튼. Top에는 주입 버튼이 없습니다.
   - 지도: 설비 이름 라벨과 자재 흐름이 보이고 점수나 0 라벨은 없습니다. 하단에서 재생·배속, 색칠 기준(치수 근거 · 종류 · 단색), 공장 환경과 공급선 표시를 바꿀 수 있습니다. 상세 카드는 닫혀 있습니다.

2. 주입 탭 → 장비 로봇 03 · 시나리오 bearing_wear · 강도 중 (모두 기본값) → 주입
   - 토스트: 주입됨 · 로봇 03 · bearing_wear
   - 탭은 자동으로 바뀌지 않습니다. Top이 정상 27 · 이상 1로 바뀌고, 로봇 03이 선택된 채 상세 카드가 열립니다.
   - 이벤트 카드에 시나리오 주입과 Rule Engine · 1위 bearing_wear 0.78 행이 추가됩니다.

3. 지도 탭 → Robot 03
   - Robot 03 위에 ! 만 표시되고 숫자 라벨은 없습니다. 다른 설비는 이름만 보입니다.
   - Robot 03을 클릭하면 상세 카드 제목이 로봇 03 · ! 이상으로 유지됩니다.

4. 상세 카드
   - 센서 변화 (기준 = 최근 300 s 평균): 진동 2.10 → 3.01 mm/s +43.3 % ↑ 증가, 전류 12.8 → 15.2 A +18.8 % ↑ 증가, 온도 48.0 → 54.0 °C +12.4 % ↑ 지연 증가
   - 가능성이 높은 원인 (규칙 기반 분석): #1 베어링 마모 0.78, #2 냉각라인 0.20
   - 권장 조치: 베어링 하우징 점검 · 라인 속도 일시 저하 · 24시간 이내 정비 일정
   - 수동 주입 중에는 센서 패널 대신 안내 문구가 나옵니다(주입은 센서 값이 아니라 변화율로 직접 들어갑니다).

5. 어드바이저 설명 보기 클릭
   - Advisor 설명: 로봇 03에서 베어링 마모 가능성이 가장 높습니다. (신뢰도 0.78)
   - 근거 3줄: 진동이 기준 대비 크게 증가했습니다. / 모터 전류가 기준 대비 증가했습니다. / 온도 상승이 진동 상승 이후 지연되어 나타났습니다.
   - 원인 후보와 score(0.78, 0.20)는 클릭 전과 같습니다.

6. 이력 탭 (사건 이력)
   - 행 1개가 사건 1개: 시각 · 로봇 03 · bearing_wear · 중 · 베어링 마모 · 0.78 · 진행 열 "진행 중 · 조치 0/3" (이상 판정이라 연한 빨강). 위쪽 필터로 전체 · 진행 중 · 해결됨을 나눠 봅니다.
   - 행 클릭 → 읽기 전용 상세: 진행 타임라인(감지 · 판정 · AI 설명 · 조치 · 해결), 권장 조치 체크리스트와 "해결 처리" 버튼, 스냅샷 · 재계산 안 함 라벨, delta 3줄, 후보 #1 베어링 마모 0.78 · #2 냉각라인 0.20, Advisor 설명
   - 5단계를 건너뛰었다면 AI 설명 단계는 "아직 없음", Advisor 설명 자리는 설명 없음으로 나옵니다. 조치 체크와 해결 처리는 스냅샷(delta·후보·score)을 바꾸지 않습니다.
   - "해결 처리"를 누르면 로봇 03이 정상으로 돌아가고 사건은 해결됨으로 닫힙니다.

7. 주입 탭 → 초기화
   - 토스트: 초기화됨 · 이력은 유지돼요
   - 지도는 전부 정상(! 없음), Top은 정상 3 · 주의 0 · 이상 0, 상세 카드는 닫힙니다.
   - 이력 탭의 행은 그대로 남고, 열려 있던 사건은 해결됨(초기화로 정상 복귀)으로 닫힙니다. 다시 주입하면 새 행이 맨 위에 추가됩니다.

센서 경보 데모 (칠러 냉각수 유량 저하)

8. 주입 탭 → 센서 경로 주입 → 설비 칠러 · 냉각수 유량 저하
   - 지도에서 칠러 이상, 냉각이 연결된 설비 5대(레이저 절단기, 로봇 01~03, 용접 전원)가 주의로 바뀌고 ! 가 붙습니다. Top은 주의 5 · 이상 1입니다.
   - 로봇 3대에 이벤트 "센서 경보 · …"와 "Rule Engine · 1위 cooling_line 0.60"이 생기고, 이력에는 시나리오 "센서 자동 감지" · 강도 "자동" 행이 3개 생깁니다(감지 근거 포함).
   - 설비를 클릭하면 센서 패널(값, 정상 범위 띠, 최근 추세선)이 나옵니다. 로봇 03의 어드바이저 설명 보기는 냉각라인 0.60을 설명하고 후보와 score는 그대로입니다.
   - 이력에서 "해결 처리"를 누르면 원인 고장(칠러)이 제거되고, 센서가 정상 범위로 돌아오면 로봇 3건이 자동으로 해결됨으로 닫힙니다. Top은 정상 28로 돌아옵니다.

원인 미상 데모 (가스 매니폴드 · 보호가스 소진)

9. 주입 탭 → 센서 경로 주입 → 설비 가스 매니폴드 · 보호가스 소진
   - 로봇 03의 보호가스 압력이 벗어나지만 진동·전류·온도는 그대로라서 엔진 1위 후보(베어링 마모 0.30)가 기준 0.5 미만입니다.
   - 이벤트는 "Rule Engine · 원인 미상", 이력 1위 후보 칸은 "원인 미상", 상세 카드는 "주의 · 원인 미상"과 "참고 후보"로 표시하고 권장 조치와 어드바이저 설명 버튼은 막습니다. 수동 주입에는 적용되지 않고 엔진 출력은 그대로입니다.

훈련 모드

10. 훈련 탭
   - 지도는 전체 화면 그대로, 문제는 오른쪽 카드에 나옵니다. 가상의 고장 8개(쉬움 · 보통 · 어려움)가 지도에 걸리고, 이상한 설비는 전부 같은 "점검 필요" 표시로만 보입니다. 설비를 눌러 실시간 센서와 연결을 보고, 공급선을 켜 보고, 라인이 막히는 모습을 보면서 원인(설비 + 고장)을 4지선다에서 고릅니다. 힌트 3단계가 있습니다.
   - 제출하면 정답 설비로 카메라가 다가가고 실제 상태(주의 · 이상)가 색으로 드러나며, 해설과 앱 Rule Engine 판정 비교가 나옵니다.
   - 실제 고장 상태 · 상단 칩 · 이벤트 · 이력에 영향이 없습니다(훈련용 복사본에만 걸림). 고장과 센서 값은 모두 가정한 시뮬레이션입니다.

문제 보고

11. 상단 바 문제 보고
   - 누르면 재현용 JSON 파일(상태, 최근 이벤트·이력, 최근 오류와 클릭, GPU 정보)을 내려받습니다. 어디에도 전송하지 않고 입력한 글자는 기록하지 않습니다. 화면이 죽으면 오류 화면에서도 받을 수 있습니다.

참고: 강도 약은 정상 판정이라 ! 가 뜨지 않습니다. motor_overload는 더미 시나리오입니다.

회귀 체크리스트

- [ ] Acceptance 4: 정상 장비에 점수·0 라벨 없음(설비 이름 라벨은 전 설비에 있음), 이상은 ! 만, 상세 카드는 선택 시에만, 이벤트는 접힘 2줄
- [ ] 엔진 후보 그대로: 상세 카드의 원인 후보와 score가 Rule Engine 출력과 같음 (0.78 / 0.20)
- [ ] Advisor는 설명만: 어드바이저 설명 보기 전후로 후보·score가 바뀌지 않고, 후보 밖 원인은 차단됨
- [ ] 탭 왕복: 7개 탭을 오가도 선택, 후보, Advisor 설명이 유지됨
- [ ] 주입 경로 하나: Top에 주입 버튼이 없고, 수동 이력 행은 주입 탭에서만 생김(센서 경보 행은 "센서 자동 감지"로 따로 생김)
- [ ] 스냅샷 불변: 강도나 시나리오를 바꿔 다시 주입해도 과거 행의 delta·후보·score가 그대로임
- [ ] 초기화: 지도 정상 복귀, 상세 카드 닫힘, 이력 유지(열린 사건은 해결됨으로 닫힘)

판단과 설명의 분리

판단은 Rule Engine이 합니다. 주입이 일어나면 delta가 Rule Engine으로 들어가 cause_candidates와 score가 정해지고, 지도 상태, 우측 후보, 이력 스냅샷은 모두 그 출력을 그대로 씁니다. Advisor는 이 후보 목록을 운영자용 문장으로 바꾸기만 하고, 후보를 추가하거나 score를 바꾸지 못하도록 가드가 막습니다. 이력 상세도 저장된 스냅샷을 보여줄 뿐 다시 계산하거나 설명을 새로 만들지 않습니다.

현재 한계

- delta 값과 Rule Engine은 프론트엔드 안의 더미 stub입니다. 센서 값도 프로필과 시나리오에서 생성한 가정 값이며 측정값이 아닙니다. Rule Engine은 로봇 3대만 판정하고, 다른 설비는 지도와 상태 칩에만 반영됩니다. Factory Simulator, Isolation Forest, FastAPI 백엔드는 아직 연결되지 않았습니다.
- Advisor는 템플릿 기반 설명이며 로컬 LLM은 아직 붙지 않았습니다.
- 실 센서, OPC UA, iPad 앱, Auth는 아직 없습니다.
- 다음 후보: 로봇 외 설비의 이벤트·이력, 태블릿·터치 대응, 서버 연결(문제 보고 자동 수집 포함).
11. Failure Scenarios

MVP 이후 확장할 고장 시나리오는 다음과 같습니다.

1. bearing_wear
   - 진동 증가
   - 전류 증가
   - 온도 지연 상승

2. nozzle_clog
   - 압력 하락
   - 유량 감소
   - 불량률 증가

3. motor_overload
   - 전류 급등
   - 진동 급등
   - 에너지 소비 증가

4. cooling_system_degradation
   - 같은 cooling_line 장비들의 온도 동시 상승
   - shared system 문제 후보 생성

5. power_instability
   - 같은 power_zone 장비들의 에너지 패턴 노이즈
   - 위치 정밀도 / 품질 흔들림

초기 MVP에서는 bearing_wear 하나만 먼저 완성합니다.

12. Tech Stack
Backend
- Python
- FastAPI
- scikit-learn
- WebSocket
- PostgreSQL
- Neon DB
- Spring Boot
- Spring Security
- WebClient
AI
- Ollama
- Qwen
- Mistral
- Gemma
- Structured Output
- whisper.cpp
- faster-whisper
- pytest
- Langfuse
Frontend
Web Admin:
- React
- TypeScript
- React Flow
- TanStack Query
- Zustand
- Axios

iPad Operator:
- React Native
- Expo
- TypeScript
- Expo Router
- Zustand
- TanStack Query
- Axios
- WebSocket
- expo-audio
- Sentry
- PostHog
Infrastructure
- Docker Compose
- GitHub Actions
- PostgreSQL
- Neon DB
13. Development Plan
Phase 0 — Project Setup & Architecture
- contracts/ 구조 생성
- 핵심 JSON Schema 작성
- docs/architecture.md 작성
- README 초안 작성
- GitHub Issue / Milestone 설정
Phase 1 — Core Backend Pipeline
목표:
scenario inject
→ sensor stream 생성
→ sensor delta 계산
→ rule matching
→ cause_candidates.json 출력

작업:

- factory_profile.json 확정
- ruleset.json 확정
- bearing_wear 시나리오 구현
- Factory Simulator 구현
- Sensor Delta Module 구현
- Rule/Profile Engine 구현
- pytest 기반 expected output 검증
Phase 1.5 — Anomaly Detection Integration
- Isolation Forest 연결
- 정상/이상 데이터 분리
- anomaly_score 생성
- Sensor Delta / Rule Engine과 연결
Phase 2 — AI Advisor
- Ollama 연결
- Qwen 모델 테스트
- Mistral 비교
- Pydantic response schema 정의
- Prompt template 작성
- structured output 적용
- fallback template 구현
- LLM 응답 평가셋 추가
Phase 3 — Web Admin Dashboard
- Factory Map
- Dependency Map
- Scenario Injector
- Event History
- Cause Candidate Viewer
- AI Advisor Test Panel
- Evaluation Dashboard
Phase 4 — iPad Operator App
- Expo 프로젝트 생성
- iPad 레이아웃 설계
- Factory Tablet Dashboard
- Equipment Detail
- AI Advisor Chat
- Event Timeline
- Maintenance Note
Phase 5 — Voice Input
- expo-audio 녹음
- FastAPI /voice/transcribe
- whisper.cpp 또는 faster-whisper 연결
- transcript 확인 UI
- AI Advisor 전송
Phase 6 — Auth Gateway
- Spring Boot Auth Gateway
- Spring Security
- JWT
- Role-based Access Control
- WebClient 기반 Core API 연동
Phase 7 — Portfolio Packaging
- Docker Compose 원커맨드 실행
- Demo GIF
- Demo Video
- Architecture Diagram
- 기술 선택 문서
- 평가 결과 표
- 블로그 글
14. GitHub Workflow

이 프로젝트는 개인 프로젝트이지만 협업 프로젝트처럼 관리합니다.

Issue

모든 작업은 Issue로 시작합니다.

예시:

[BE] bearing_wear 시나리오용 Sensor Delta 계산 구현
[BE] ruleset.json 기반 Rule Engine 초안 구현
[AI] cause_candidates 기반 Advisor 응답 schema 설계
[WEB] Scenario Injector 관리자 화면 구현
[APP] iPad Operator Dashboard 와이어프레임 구현
[DOCS] Phase 1 아키텍처 다이어그램 추가
Branch
main
├─ develop
│  ├─ feature/backend-sensor-delta
│  ├─ feature/rule-engine
│  ├─ feature/web-scenario-injector
│  ├─ feature/ipad-advisor-ui
│  └─ docs/readme-architecture

브랜치 규칙:

feature/기능명
fix/수정명
docs/문서명
refactor/대상
experiment/실험명
Commit

커밋 메시지 형식:

type: summary

예시:

feat: add bearing wear scenario generator
feat: implement sensor delta calculation
feat: add ruleset based cause candidate matching
docs: update phase 1 development plan
test: add rule engine expected output test
refactor: separate event repository interface
Pull Request

PR에는 다음 내용을 포함합니다.

## 작업 목적

## 변경 내용

## 테스트 방법

## 실행 결과

## 남은 문제
Milestones
Phase 0 - Project Setup & Architecture
Phase 1 - Core Backend Pipeline
Phase 1.5 - Anomaly Detection Integration
Phase 2 - AI Advisor
Phase 3 - Web Admin Dashboard
Phase 4 - iPad Operator App
Phase 5 - Voice Input
Phase 6 - Auth Gateway
Phase 7 - Portfolio Packaging
15. Getting Started

아직 초기 개발 단계입니다. 실행 방법은 구현 진행에 따라 업데이트됩니다.

1. Clone
git clone https://github.com/{username}/k-factory-copilot.git
cd k-factory-copilot
2. Environment
cp infra/env.example .env
3. Run with Docker Compose
docker compose -f infra/docker-compose.yml up --build
4. FastAPI Docs
http://localhost:8000/docs
5. Web Admin Dashboard
http://localhost:3000
6. iPad Operator App
cd frontend/ipad-operator
npm install
npx expo start
16. What This Project Does Not Do

프로젝트 범위를 지키기 위해 다음은 하지 않습니다.

1. 실제 공장 데이터 연동을 목표로 하지 않는다.
2. OPC UA를 메인 데이터 파이프라인으로 사용하지 않는다.
3. LLM이 직접 원인을 판단하게 하지 않는다.
4. 완전한 Root Cause Analysis라고 표현하지 않는다.
5. Factorio / Satisfactory 수준의 게임형 UI를 목표로 하지 않는다.
6. 처음부터 완성형 모바일 앱을 만들지 않는다.
7. 처음부터 인증 시스템을 만들지 않는다.
8. 처음부터 파인튜닝하지 않는다.
9. 처음부터 음성 명령 실행을 넣지 않는다.
10. 처음부터 RAG / Vector DB를 넣지 않는다.
11. 여러 공장 프로파일을 처음부터 만들지 않는다.
17. Current Status
Status: Planning / Architecture Design
Current Focus: Repository structure, contracts, Phase 1 backend pipeline
MVP Target: Robot 03 bearing_wear scenario → cause_candidates → AI Advisor explanation
18. License

TBD

19. Author

Morgan

K-Factory Copilot is a personal portfolio and learning project focused on factory observability, explainable anomaly-to-cause pipelines, and local AI advisor architecture.
