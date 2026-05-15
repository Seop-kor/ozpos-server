---
name: requesting-code-review
description: Use when completing a feature, implementing major changes, or before merging. Performs two-stage review (spec compliance → code quality) using subagents with precisely crafted context.
---

# Requesting Code Review (2-Stage)

피처 구현이 끝나면 **2단계 리뷰**를 수행합니다. Codex subagent workflow가 정확히 필요한 컨텍스트만
받고 리뷰하므로, 현재 세션의 컨텍스트는 오염되지 않고 계속 작업에 쓸 수 있습니다.

**핵심 원칙:** 빨리, 자주 리뷰합니다.

---

## When to Request Review

**필수:**
- 피처 구현 완료 후
- 메인 브랜치 머지 전

**선택적이지만 유용:**
- 막혔을 때 (새로운 시각)
- 리팩터 전 (베이스라인 확인)
- 복잡한 버그 수정 후

---

## 2-Stage Flow

```
[피처 구현 완료]
      ↓
Stage 1: Spec Compliance (서브에이전트)
  입력: 설계 문서 + diff
  검사: 모든 Unit 구현됐나? 모든 Test Case가 test()로 있나? Signature 일치?
      ↓
  Critical 있음? ─YES→ receiving-code-review 호출해 수정 → Stage 1 재실행
      ↓ NO
Stage 2: Code Quality (서브에이전트)
  입력: diff (설계 문서 불필요)
  검사: DRY, YAGNI, 네이밍, 복잡도, 에러 처리, 타입 안전성
      ↓
  Critical/Important 있음? ─YES→ receiving-code-review 호출해 수정
      ↓ NO
완료
```

**Stage 1을 먼저 통과해야 Stage 2로 갑니다.** 설계와 맞지도 않는 코드의 품질을
논하는 건 의미 없기 때문입니다.

---

## How to Request

### 1. SHA 범위 확정

```bash
# 이전 피처가 끝난 커밋 (또는 origin/main)
BASE_SHA=$(git rev-parse origin/main)   # 또는 적절한 기준점
HEAD_SHA=$(git rev-parse HEAD)

# diff 변경 파일 미리 확인 (건전성 체크)
git diff --stat $BASE_SHA..$HEAD_SHA
```

### 2. 설계 문서 경로 확정

```bash
DESIGN_DOC=docs/design/YYYY-MM-DD-<주제>.md
test -f "$DESIGN_DOC" || echo "⚠️ 설계 문서 없음 — designing 스킬 먼저 돌렸는지 확인"
```

### 3. Stage 1 서브에이전트 디스패치

Codex subagent workflow로 서브에이전트 호출. 프롬프트는 `spec-compliance-prompt.md`의 템플릿을 채워서 전달.

**전달할 정보:**
- `{DESIGN_DOC_PATH}` — 설계 문서 경로
- `{BASE_SHA}` — 시작 커밋
- `{HEAD_SHA}` — 끝 커밋
- `{FEATURE_DESCRIPTION}` — 한두 줄 요약

### 4. Stage 1 결과 처리

- **PASS** → Stage 2로 진행
- **FAIL (Critical 있음)** → `receiving-code-review` 스킬 호출, 지적사항 수정 후
  Stage 1 재실행
- **Important만 있음** → 사용자에게 보고하고 판단 요청 (보통 수정 후 Stage 1 재실행)

### 5. Stage 2 서브에이전트 디스패치

Codex subagent workflow로 또 다른 서브에이전트 호출. 프롬프트는 `code-quality-prompt.md`.

**전달할 정보:**
- `{BASE_SHA}`, `{HEAD_SHA}`, `{FEATURE_DESCRIPTION}`
- (설계 문서는 Stage 2에서는 불필요 — 코드 품질만 보기 때문)

### 6. Stage 2 결과 처리

- **Ready to merge** → 완료
- **Needs revision (Critical/Important)** → `receiving-code-review` 스킬 호출

---

## Example

```
[피처: NotificationChecker + NotificationStore + NotificationScheduler 구현 완료]

You: 2단계 리뷰 돌리겠습니다.

# SHA와 설계 문서 확정
BASE_SHA=abc1234
HEAD_SHA=def5678
DESIGN_DOC=docs/design/2026-04-16-notifications.md

# Stage 1 디스패치
[Spawn a read-only Codex subagent using code-reviewer instructions; prompt = spec-compliance-prompt.md content filled with concrete paths/SHAs]

Stage 1 결과:
  Unit coverage: ✅ 3/3
  Test Case coverage: ❌ NotificationStore.markNotified의 "덮어쓰기 허용" Case가 테스트 누락
  Signature: ✅
  Extra tests: ⚠️ NotificationScheduler.test.ts에 설계에 없는 "throttles rapid calls" 테스트 있음
  Overall: FAIL (Critical 1개)

You: [receiving-code-review 스킬 호출]
  - 누락된 Case의 테스트 추가 (RED → GREEN)
  - 설계에 없는 throttle 테스트: 설계 문서 업데이트 후 유지 OR 삭제 결정
[Stage 1 재실행]

Stage 1 결과 (재실행): PASS

# Stage 2 디스패치
[Spawn a read-only Codex subagent using code-reviewer instructions; prompt = code-quality-prompt.md content filled with concrete paths/SHAs]

Stage 2 결과:
  Strengths: 순수 함수 / impure 함수 경계 명확, 타입 명료
  Issues:
    - Important: NotificationScheduler가 너무 많은 일 (checker 호출 + store 호출 + 토스트 표시)
      → 권장: dispatcher를 분리
    - Minor: 매직 넘버 60000 (1분)을 상수로
  Overall: Needs revision

You: [receiving-code-review 스킬 호출 — Important 수정]
```

---

## Integration with Workflow

**3단계 플로우에서 리뷰의 위치:**

```
designing → test-driven-development → requesting-code-review (Stage 1 → Stage 2)
```

TDD가 끝났다는 것은 "설계 문서의 모든 Unit × 모든 Case가 통과하는 테스트로 존재한다"
는 것입니다. 그 상태에서 리뷰를 돌리는 게 맞습니다. TDD 중간에 리뷰하지 않습니다.

---

## Red Flags

**절대 금지:**
- "단순한 피처니까 리뷰 건너뜀" — 설계 문서가 있다면 리뷰도 함
- Critical 무시
- Important 수정 없이 다음 피처로
- 타당한 기술적 피드백에 논쟁

**리뷰어가 틀린 경우:**
- 기술적 근거와 함께 반박
- 동작을 증명하는 코드/테스트 보여주기
- 명확화 요청

---

## Templates

- Stage 1 프롬프트: `spec-compliance-prompt.md`
- Stage 2 프롬프트: `code-quality-prompt.md`
