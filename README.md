# LLM 번역기 Plus — Lumiverse Spindle 포팅

SillyTavern용 `LLM-Context-Translator` / `LLM 번역기 Plus` 확장을 Lumiverse의 Spindle 확장 시스템에 맞춰 포팅한 버전입니다.

## 구성

```text
llm_context_translator_plus/
├── spindle.json
├── package.json
├── tsconfig.json
├── src/
│   ├── backend.ts
│   └── frontend.ts
└── dist/
    ├── backend.js
    └── frontend.js
```

## 주요 기능

- Lumiverse Spindle 확장으로 설치 가능한 `spindle.json` 제공
- Drawer 탭 `번역+` 설정 UI
- 입력창 액션 `LLM 번역`
- 마지막 메시지 번역
- 임의 텍스트 번역
- 최근 채팅 히스토리를 포함한 컨텍스트 기반 번역
- 표시 방식:
  - 번역문으로 교체
  - 번역문 + 원문
  - 번역문 + 접힌 원문
- 사용자별 설정 저장: `spindle.userStorage`

## 필요한 권한

`spindle.json`에서 다음 권한을 요청합니다.

- `generation`: Lumiverse LLM 호출
- `chats`: 채팅/메시지 조회
- `characters`: 향후 캐릭터 컨텍스트 확장용
- `chat_mutation`: 메시지 내용 업데이트
- `ui_panels`: Drawer/Input action UI 등록

## 빌드 확인

이 폴더에서 아래 명령으로 검증할 수 있습니다.

```bat
npx tsc --noEmit
bun build src/backend.ts --outfile dist/backend.js --target bun
bun build src/frontend.ts --outfile dist/frontend.js --target browser
```

현재 작업 시점에 위 타입체크 및 빌드가 성공했습니다.

## 사용 방법

1. Lumiverse의 Spindle 확장 설치/로컬 확장 등록 기능에서 이 폴더를 확장 repo로 사용합니다.
2. 권한 승인 화면에서 요청 권한을 승인합니다.
3. Lumiverse UI의 Drawer 탭 `번역+`에서 프롬프트/히스토리/표시 방식을 조정합니다.
4. 채팅 입력창의 `LLM 번역` 액션 또는 `번역+` 탭 버튼으로 번역을 실행합니다.

## 참고

원본 SillyTavern 확장의 IndexedDB 캐시, 메시지별 세부 편집 UI, 자동 번역 트리거 등은 Lumiverse Spindle API에 맞춘 MVP 범위에서는 제외했습니다. 현재 버전은 Lumiverse 기본 LLM 생성 API와 메시지 업데이트 API를 사용해 핵심 번역 기능을 우선 제공합니다.