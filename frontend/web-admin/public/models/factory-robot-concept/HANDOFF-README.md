# 실시간 3D팀 인계 — 공장 로봇 외형 컨셉

인계본 생성일: 2026-10-15 (Asia/Seoul). 아래 정보는 동봉된 GLB에 대한 내용이다.

## 먼저 전달할 것
이 폴더 전체 ZIP을 전달한다. 핵심 자산은 public/models/factory-robot-concept/factory-robot-concept.glb 이며 STL은 정지 메시 참고용이다. 원본은 scripts/generate-factory-robot-concept.mjs 절차형 생성 소스다. 원본 STEP/CAD는 없다.
기존 http://127.0.0.1:8766 링크는 작성자 PC에서 실행되는 로컬 서버 주소다. 다른 PC의 127.0.0.1은 그 PC 자신이므로 동일 링크만 공유하면 모델이 전달되지 않는다. 수신자는 아래 뷰어를 실행하거나 팀 호스팅에 올려야 한다. 이번 인계에서는 외부 호스팅에 업로드하지 않았다.

## 자산 계약
- 단위: m. +Y 위, +Z 전면. 원점: 바닥판 바닥 중앙.
- 기본 자세 외곽: W0.640 × D1.103 × H1.341m. 자체 설정 치수이며 제조사 공개 사양 재현/인증 값이 아니다.
- GLB: 1,734,032 bytes. 삼각형: 30,008개(반복 인스턴스 포함).
- 정적 외장 컨셉. 모든 부품의 근거 등급은 추정(예시). 제조사 CAD 형상·사진·로고·도면 미사용. 일반적인 설비 특징 관찰을 참고한 자체 예시 형상이며 독창성/법적 권리 검증을 수행한 것은 아니다.
- PBR metallic/roughness, 중립 회색 계열. neutral_paint / machined_metal / neutral_polymer. 색상에 설비 상태 의미를 부여하지 않았으며 앱에서 매핑 가능.
- 반복 볼트: EXT_mesh_gpu_instancing 사용. GLTFLoader로 인스턴스를 보존한다. 그룹 단위 관절 변환이므로 로봇 전체를 한 메시로 합치면 관절 움직임을 잃는다.

## 관절 계층과 로컬 회전축
GLB의 concept_scene 안에 factory_robot_concept 루트가 있다.
|노드|부모|로컬 회전축|
|---|---|---|
|j1|factory_robot_concept|Y|
|j2|j1|X|
|j3|j2|X|
|j4|upper_arm_offset (j3 아래)|Z|
|j5|j4|X|
|j6|j5|Z|
회전 단위 rad. 기본 자세/부호는 자체 시각화 규칙으로 실제 제어기 영점과 대응되지 않는다. 실제 가동 범위/관절 제한은 미지정. 모델에는 베이크된 애니메이션 클립이 없다. 뷰어의 자세 버튼이 노드 quaternion을 변경한다. examples/integration.js 참고.
그리퍼는 없으며 말단 플랜지까지만 있다. 툴 부착용 TCP/소켓은 별도 정의가 필요하다. j6 원점 자체를 검증된 TCP로 해석하지 않는다.

## 뷰어 실행
1. 이 ZIP을 압축 해제한다.
2. 폴더 안에서 npm install 을 실행한다. 인터넷 연결 및 Node.js가 필요하다.
3. python3 -m http.server 8767 --bind 127.0.0.1 을 실행한다.
4. http://127.0.0.1:8767/public/model-review/factory-robot-concept.html?view=iso 를 연다.
내부 importmap이 /node_modules/three/ 를 참조하므로 HTML 파일을 직접 더블클릭하지 말고 폴더 전체를 HTTP로 제공한다. 서버 실행 중에만 링크가 열린다.
Three.js 버전은 package.json에 고정했다. 생성 소스 재실행은 npm run generate. 재생성 시 EVIDENCE.md/verification.json도 생성 시점 정보로 다시 작성된다. 동봉된 뷰어 검증/스크린샷은 재생성 후 자동 갱신되지 않는다.

## 검증한 범위
GLB 재로딩, 바닥/외곽 치수, j1~j6 이름과 축, 부모-자식 회전, snake_case, 인스턴스 포함 삼각형 수, STL 헤더 및 크기, 클램프 받침의 본체 접촉, 두 정비 커버의 치수/재질 일치. 정면/측면/위/입체와 기본/회전/굽힘 3자세 육안 확인. 브라우저 pageerror 0 (기록 당시).
이는 엔진 전체 호환성/성능 보증이 아니다. 팀 엔진에서 instancing, 조명/재질, 스케일을 재확인한다.

## 남은 항목
- 전체 가동 범위 간섭/물리 시뮬레이션/제어 연동/강도/하중/속도 미검증.
- 조립면에는 외장 메시 겹침이 남아 있다. 제조용 솔리드/수밀 프린트 원본이 아니다.
- 외부 케이블은 하부 팔 단일 링크에 붙은 시각화 예시. 관절 간 동적 케이블 해석 없음.
- LOD, 충돌 프록시, UV/텍스처 제작 적합성, lightmap UV, 렌더링 예산, 팀 좌표계 변환 기준은 별도 합의/검증 필요.
- 동봉된 STL은 관절 계층/재질/애니메이션을 유지하지 않는다. 앱 탑재에는 GLB를 기준으로 한다.

## 증빙 및 외부 라이브러리
부품별 근거는 EVIDENCE.md, 수치 및 검증 결과는 JSON, 화면은 PNG. 체크섬은 SHA256SUMS.json.
런타임 의존성 Three.js는 MIT License, 원문 THREE-LICENSE.txt 동봉. node_modules와 제조사 참고 파일은 동봉하지 않았다. 이 문서는 별도 자산 라이선스나 권리 보증을 부여하지 않는다.
