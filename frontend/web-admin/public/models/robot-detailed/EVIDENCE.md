# 상세 로봇 외장 — 검증 및 근거

2026-10-14. ABB IRB 2600ID-15/1.85 공개 치수 기반 자체 외장 시제품. 이전 robot-pilot은 보존. 제조사 CAD 형상은 사용하지 않음.

## 파일과 검증

- review-front.png: 73,917 bytes
- review-iso.png: 148,753 bytes
- review-side.png: 85,187 bytes
- review-top.png: 57,305 bytes
- robot-detailed.glb: 2,193,956 bytes
- robot-detailed.stl: 2,499,684 bytes
- verification.json: 20,429 bytes
- viewer-validation.json: 3,509 bytes

GLB 2,193,956 bytes, 삼각형 49,992개(인스턴스 펼친 기준). STL 49,992 triangles, 바이너리 길이 검증 통과.
three.js GLTFLoader로 재로딩 후 외곽·관절 6개·축 메타데이터·삼각형 수 확인, 브라우저 오류 0. 정면·측면·위·입체 캡처 육안 확인.
외곽 w×d×h = 0.511×1.410×1.590 m. +Y 위, +Z 앞, 원점은 베이스 바닥 중앙. 높이 1.600m 대비 -0.625%. 전체 폭·깊이 제조사 확정값은 모름. 원래 가정 표의 외곽 ±2% 충족을 주장하지 않음.
j1: Y, j2: X, j3: X, j4: Z, j5: X, j6: Z (로컬). 관절 영점·회전 부호·충돌·실물 제어 적합성은 미검증.
생성 원본: frontend/web-admin/scripts/generate-robot-detailed.mjs. node로 재생성 가능.

## 사용 권한 확인

확인: 공식 웹 약관, 공개 검색, 내려받은 IRB2600ID_15kg-185_rev02_STEP_j.zip 구성과 STEP 헤더. ZIP에 개별 LICENSE/README 없음. 확인한 STEP 헤더는 작성자 ABB와 내보내기 정보만 포함. 상업·비공개 웹앱용 변환·배포 허가를 찾지 못함. 금지 확정과 허가 미확인을 구분하며, CAD 미사용으로 진행.
https://www.abb.com/global/en/company/provider-information §1·§3: www.abb.com 대상이며 타 도메인 개별 조건을 대신하지 않음.
> is prohibited without prior written permission from ABB.
위 문구는 일반 웹 콘텐츠 사용 조항 발췌이며 CAD 개별 라이선스가 아님. ABB에 메시지를 보내거나 허가를 받은 것은 아님.

## 부품별 근거

|이름|형상 근거|치수·배치 근거|출처|CAD 약관|
|---|---|---|---|---|
|robot_pilot|추정(예시)|자체 설계 예시|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|base_plate|추정(예시)|공개 규격에서 계산|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|base_plinth|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|service_panel|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|base_bolts|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|j1|추정(예시)|자체 설계 예시|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|waist_ring|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|waist_shell|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_support|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|j2|추정(예시)|shoulder height 0.445m is illustration assumption; forward offset 0.150m from drawing|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|shoulder_hub|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_hub_cap_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_hub_bolts_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_hub_cap_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_hub_bolts_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|j3|추정(예시)|공개 규격에서 계산|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|elbow_hub|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_hub_cap_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_hub_bolts_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_hub_cap_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_hub_bolts_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_riser|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|upper_axis_offset|추정(예시)|공개 규격에서 계산|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|j4|추정(예시)|자체 설계 예시|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|roll_seal|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|roll_housing|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|j5|추정(예시)|upper elbow reference to j5 = 0.786m; division at j4 is illustrative|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|wrist_hub|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_hub_cap_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_hub_bolts_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_hub_cap_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_hub_bolts_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_yoke|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|j6|추정(예시)|자체 설계 예시|https://search.abb.com/library/Download.aspx?DocumentID=3HAC085909-001&LanguageCode=en&Action=Launch|해당 없음: 제조사 CAD 미사용|
|flange_neck|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|bored_tool_flange|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|flange_outer_lip|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_seal_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_center_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_center_lip_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_plug_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_seal_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_center_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_center_lip_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_plug_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_hub_bolts_left_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|wrist_hub_bolts_right_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|forearm_casting|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|forearm_gasket|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|forearm_cover|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|forearm_cover_screws|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|forearm_cover_screws_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_seal_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_center_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_center_lip_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_plug_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_seal_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_center_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_center_lip_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_plug_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_hub_bolts_left_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|elbow_hub_bolts_right_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|lower_arm_casting|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|arm_rib_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|arm_rib_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|lower_gasket|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|lower_service_cover|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|lower_cover_screws|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_seal_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_center_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_center_lip_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_plug_left|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_seal_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_center_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_center_lip_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_plug_right|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_hub_bolts_left_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|shoulder_hub_bolts_right_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|lower_cover_screws_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|lower_service_conduit|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|conduit_corrugations|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|conduit_clamp_0_2|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|conduit_clamp_0_66|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|waist_seal_0_011|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|waist_seal_0_069|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|waist_seal_0_2|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_collar|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_can|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_end|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_fin_0|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_fin_1|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_fin_2|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_fin_3|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|motor_fin_4|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|base_bolts_sockets|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_gasket|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_plate|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_0|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_ring_0|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_face_0|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_1|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_ring_1|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_face_1|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_2|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_ring_2|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|
|connector_face_2|추정(예시)|자체 설계 예시|없음|해당 없음: 제조사 CAD 미사용|

상세 외장 치수는 예시 설계 파라미터이며 제조사 측정값이 아님. 팔 단면, 커버, 씰, 냉각 리브, 케이블 주름, 커넥터, 플랜지 구멍·패턴 및 표면 재질 모두 추정. 반복 볼트 및 주름은 인스턴스. 숨은 기어·모터 내부는 생성하지 않았으나 결합 부품 일부 겹침은 있음.
공개 규격에서 계산한 주요 배치: 하부 링크 0.900m, 상부 축 높이차 0.150m, 상부 기준→j5 0.786m. 도면 출처 3HAC085909-001 Rev K p16. 도면 이미지를 결과물에 복제하지 않음.
STL은 이 자체 제작 메시의 정지 자세 파생 파일이며 원본 STEP가 아님. 실제 ABB 형상의 정확한 복제품으로 주장하지 않음. 공장 지도 연결 미실시.

## 접합 수정 — 2026-10-14
사용자 표시 부위: forearm_casting 끝 0.558m와 j4 roll_seal 시작 0.560m 사이 2mm 틈 확인. 외장 끝을 0.563m로 연장하여 씰과 3mm 겹침 처리. roll_housing 시작도 0.583m로 이동하여 씰 끝 0.585m와 2mm 겹침 처리. 시각화용 접합이며 제조사 조립 공차 아님. GLB/STL 재생성, GLB 재로딩 및 정면·측면·위·입체 재캡처 완료. 크기·삼각형·파일 용량 변화 없음.

## 팔꿈치 연결부 수정 — 2026-10-14

사용자 지적 영역의 elbow_riser와 forearm_casting의 교차 경계를 제거했다. elbow_riser 별도 박스를 삭제하고 forearm_casting을 팔꿈치까지 연장한 단일 연속 곡면으로 교체했다. loft 끝면의 잘못된 면 방향도 정정했다. 제조사 CAD 재현이 아니라 기존 추정(예시) 형상의 시각적 오류 수정이다. 관절 좌표/축은 유지했다.

현재 GLB 2,138,988 bytes, 삼각형 49,532개. 외곽 w/d/h [0.5109999775886536, 1.4099999995706602, 1.581999997869134]. STL 헤더 49,532개 및 파일 크기 84+50×개수 일치. three.js 재로딩 pageerror 0, j1~j6 및 로컬 축 확인. 상세 모델과 비교 뷰어의 정면·측면·위·입체 캡처를 갱신했다. 이전 파일 크기/높이는 역사적 기록이고 현재 수치는 이 절과 verification.json을 우선한다.
