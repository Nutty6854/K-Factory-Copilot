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

대표 데모는 Robot 03 Bearing Wear입니다.

1. Web Admin Dashboard에서 bearing_wear 시나리오를 주입한다.
2. Factory Simulator가 Robot 03의 진동, 전류, 온도 패턴을 변화시킨다.
3. Sensor Delta Module이 baseline 대비 변화율을 계산한다.
4. Rule/Profile Engine이 bearing_wear 원인 후보를 생성한다.
5. iPad App에서 Robot 03이 이상 장비로 표시된다.
6. 운영자가 AI Advisor에게 “Robot 03 왜 이상 상태야?”라고 질문한다.
7. AI Advisor가 원인 후보, 근거, 추천 조치를 설명한다.
8. Web Admin Dashboard에서 이벤트 로그와 평가 결과를 확인한다.
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
