# radar-provision

Radar 장비(ESP32-C5) **BLE WiFi 프로비저닝** 정적 페이지 (Web Bluetooth).
samwon4 재실 시스템 관리자 페이지(Part B)가 이 페이지를 팝업으로 열어 사용합니다.

- 사양 원문: `samwon4-web` repo 의 `RADAR_BLE_PROVISIONING_WEB.md`
- 호스팅: **GitHub Pages (public)** — BLE 페이지는 공개 URL 전제(보안 = BLE 물리적 근접성 ~10m)
- 백엔드 없음. 브라우저 ↔ 장비 BLE 직접 통신.

## 구성
| 파일 | 역할 |
|------|------|
| `index.html` | UI (장비 연결 / 자격증명 입력 / 진행 상태 / 로그) |
| `app.js` | Web Bluetooth 연결·구독·전송 + 완료 시 opener 로 postMessage |
| `provision-protocol.js` | 순수 프로토콜 함수 (패킷 빌드/파싱/체크섬, UUID·enum) — 브라우저/Node 공용 |
| `provision-protocol.test.js` | node:test 단위 테스트 (의존성 0) |

## 개발 / 테스트
```bash
npm test          # 패킷 빌더/파서/체크섬 단위 테스트 (node --test)
```
로컬 미리보기는 HTTPS 가 필요합니다 (Web Bluetooth). GitHub Pages 배포본으로 실기기 테스트하세요.

## 관리자 페이지 연결
samwon4-web 의 환경변수에 이 Pages URL 을 설정:
```
NEXT_PUBLIC_PROVISION_URL=https://<owner>.github.io/radar-provision/
```
관리자 → 장비 관리 → 장비 프로비저닝 에서 이 페이지를 팝업으로 열고,
완료 시 `postMessage({type:'provision-complete', result:{mac, ip, server}})` 로 결과를 회신합니다.

## 동작 요건
- Chrome / Edge 89+ (데스크톱·Android). iOS 미지원.
- 장비가 BLE 광고(`radar_XXXXXX`) 중이어야 검색됨 (펌웨어 1.3.0+).
