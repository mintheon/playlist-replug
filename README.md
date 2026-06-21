<div align="center">

<img src="extension/icons/icon128.png" width="80" alt="Playlist Replug">

# Playlist Replug

음악 플랫폼의 플레이리스트를 유튜브로 자동 변환하는 크롬 확장 프로그램

[![GitHub release](https://img.shields.io/github/v/release/mintheon/playlist-replug?color=22c55e&label=release)](https://github.com/mintheon/playlist-replug/releases/latest)
![Platform](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=google-chrome&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-22c55e)

</div>

---

별도 API 키나 서버 없이, 로그인된 유튜브 세션으로 직접 동작합니다.

## 목차

- [스크린샷](#스크린샷)
- [지원 플랫폼](#지원-플랫폼)
- [주요 기능](#주요-기능)
- [설치](#설치)
- [사용 방법](#사용-방법)
- [주의사항](#주의사항)
- [개인 정보](#개인-정보)

---

## 실행 화면

<img width="408" height="614" alt="iShot_2026-06-22_00 38 50" src="https://github.com/user-attachments/assets/90acdcd3-04eb-496c-811a-32747257b5f9" />


---

## 지원 플랫폼

| 플랫폼 | 상태 |
|--------|------|
| Melon | 지원 |
| Spotify | 개발 중 |
| 기타 | 추후 지원 예정 |

---

## 주요 기능

- 완전 무료, 별도 가입 불필요
- 멜론 플레이리스트 URL (단축 URL 포함) 입력만으로 자동 변환
- 곡 수 제한 없음 (50곡 이상 페이지네이션 자동 처리)
- 새 플레이리스트 생성 / 기존 플레이리스트에 추가 선택 가능
- 팝업을 닫아도 백그라운드에서 계속 실행, 재오픈 시 진행 상황 복원
- 변환 완료 시 시스템 알림

**유튜브 영상 선택 우선순위**

| 순위 | 기준 |
|------|------|
| 1 | YouTube Music Topic 채널 (공식 음원) |
| 2 | 공식 아티스트 채널 + MV |
| 3 | 인증 채널 + MV |
| 4 | 공식 아티스트 채널 |
| 5 | MV 키워드 포함 영상 |
| 6 | 일반 검색 결과 |

---

## 설치

[설치 방법 보기](./INSTALL.md)

---

## 사용 방법

1. 유튜브에 로그인된 탭을 열어둡니다
2. 크롬 툴바의 Playlist Replug 아이콘 클릭
3. 음악 플랫폼 선택 후 플레이리스트 URL 입력
   - 일반 URL: `https://www.melon.com/mymusic/playlist/mymusicplaylistview_inform.htm?plylstSeq=...`
   - 단축 URL: `https://kko.to/...` (멜론 앱 공유 버튼에서 복사)
4. 새 플레이리스트 이름 입력 또는 기존 플레이리스트 URL 입력
5. 변환 시작 클릭

변환 중에는 팝업을 닫아도 백그라운드에서 계속 진행됩니다.

---

## 주의사항

- 유튜브에 로그인되어 있어야 합니다
- 멜론 플레이리스트는 공개 상태여야 합니다
- 변환 속도는 곡당 약 1~2초 소요됩니다 (100곡 기준 약 2분)

---

## 개인 정보

외부 서버와 통신하지 않습니다.
멜론과 유튜브 외의 서비스로 어떠한 데이터도 전송되지 않으며,
입력한 URL과 진행 상태는 브라우저 로컬 스토리지(`chrome.storage.local`)에만 저장됩니다.

---

<div align="center">

by [mintheon](https://github.com/mintheon)

</div>
