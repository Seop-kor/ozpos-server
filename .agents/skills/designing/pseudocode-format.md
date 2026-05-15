# Pseudocode Format (TDD-Ready)

이 문서는 `designing` 스킬이 산출하는 슈도코드의 **규격**입니다. 이 규격을 따른
슈도코드는 `test-driven-development` 스킬이 그대로 읽어서 각 Test Case를 RED
테스트로 변환합니다.

**원칙:** 슈도코드는 *코드의 초안*이 아니라 *계약과 테스트 케이스의 정의*입니다.
실제 코드는 TDD 단계에서 테스트를 통해 드러납니다.

---

## 기본 버전 (간결) — 기본값

대부분의 Unit은 이 형태로 충분합니다. **순수 함수, 단순 변환, 작은 헬퍼**는 전부
이쪽.

### 형식
````markdown
## Unit: <모듈/네임스페이스>.<이름>

`<이름>(<인자>: <타입>) → <반환 타입>`  
<한 문장으로 책임 설명>. <순수 함수인지 여부>.

**Cases:**
| given | expect |
|---|---|
| `<입력>` | `<출력>` |
| `<엣지>` | `<출력>` |
| `<에러>` | `throws <타입>` |

Side effects: <none | 파일 IO | 네트워크 | DB | UI>
Dependencies: <다른 Unit 이름들 | 없음>
````

### 예시
````markdown
## Unit: NotificationChecker.check

`check(todos: Todo[], now: Date) → NotifyAction[]`  
마감 지났고 아직 알림 안 간 todo에 대한 알림 액션을 반환. 순수 함수.

**Cases:**
| given | expect |
|---|---|
| `[{id:1, due:"2025-01-01", notifiedAt:null}]`, now=`2025-01-02` | `[{type:"notify", todoId:1}]` |
| `[{id:1, due:"2025-01-01", notifiedAt:"2025-01-01T09:00"}]` | `[]` |
| `[]` | `[]` |
| `[{id:1, due:"2025-01-02", notifiedAt:null}]`, now=`2025-01-01` | `[]` |

Side effects: none
Dependencies: 없음
````

---

## 자세 버전 — 복잡한 Unit 전용

아래 **세 가지 중 하나라도 해당**되면 자세 버전을 씁니다:
- 부수효과가 있음 (파일 IO, 네트워크, DB, UI, 시스템 콜)
- 에러 처리가 본질적 책임의 일부 (여러 에러 타입 구분, 복구 전략 등)
- 의존성이 여럿 (2개 이상의 다른 Unit/외부 서비스에 의존)

### 형식
````markdown
## Unit: <모듈/네임스페이스>.<이름>

**File:** `<소스 파일 경로>`  
**Test file:** `<테스트 파일 경로>`

**Signature:** `<이름>(<인자>: <타입>) → <반환 타입>`

**Types (필요 정의):**
- `<타입 이름> = <정의>`

**Responsibility:** <한 문단>

**Preconditions:**
- <입력/상태에 대한 가정>

**Postconditions:**
- <반환값/부수효과에 대한 보장>

**Behavior (sequential):**
1. <단계>
2. <단계>
...

**Test Cases:**
- **<이름>** — <한 줄 의도>  
  given: `<입력>`  
  expect: `<출력 또는 throws>`
- **<이름>** — <한 줄 의도>  
  given: `<입력>`  
  expect: `<출력>`

**Error handling:**
- <어떤 에러를 어떻게 처리하는가>

**Side Effects:** <구체적으로 뭐가 일어나는지>
**Dependencies:** <목록>
**Used by:** <누가 쓰는가 — 호출자들>
````

### 예시
````markdown
## Unit: NotificationStore.markNotified

**File:** `src/notifications/store.ts`  
**Test file:** `tests/notifications/store.test.ts`

**Signature:** `markNotified(todoId: number, at: Date) → Promise<void>`

**Types:**
- 외부 정의된 `Todo` 사용

**Responsibility:** 주어진 todoId의 `notifiedAt` 필드를 지정 시각으로 저장소에 기록.
저장소는 IndexedDB. 이미 값이 있으면 덮어쓴다.

**Preconditions:**
- todoId는 저장소에 실존하는 todo를 가리킨다
- at은 유효한 Date

**Postconditions:**
- 성공시 해당 todo의 notifiedAt == at
- 실패시 저장소 상태는 호출 전과 동일 (트랜잭션)

**Behavior:**
1. IndexedDB 트랜잭션 시작 (readwrite)
2. todoId로 조회
3. 없으면 `NotFoundError` throw
4. notifiedAt 필드 업데이트
5. 트랜잭션 commit

**Test Cases:**
- **happy path** — 존재하는 todo 업데이트  
  given: 저장소에 `{id:1, notifiedAt:null}` 존재, `markNotified(1, date)` 호출  
  expect: 저장소에 `{id:1, notifiedAt:date}` 저장됨
- **not found** — 존재하지 않는 id  
  given: 빈 저장소, `markNotified(999, date)`  
  expect: throws `NotFoundError`
- **덮어쓰기 허용**  
  given: `{id:1, notifiedAt:date1}` 존재, `markNotified(1, date2)`  
  expect: 저장소에 `{id:1, notifiedAt:date2}`

**Error handling:**
- `NotFoundError`: 호출자가 처리 (로그 후 무시 권장)
- IndexedDB 실패: 원본 에러 그대로 전파

**Side Effects:** IndexedDB 쓰기
**Dependencies:** `IndexedDBAdapter`
**Used by:** `NotificationScheduler.dispatch`
````

---

## 어느 버전을 쓸지 결정하는 체크리스트

슈도코드 작성 전에 각 Unit에 대해:

- [ ] 이 Unit에 부수효과(파일/네트워크/DB/UI)가 있는가?
- [ ] 이 Unit이 여러 종류의 에러를 구분해서 처리하는가?
- [ ] 이 Unit이 2개 이상의 다른 Unit/외부 서비스에 의존하는가?

하나라도 **예**면 자세 버전. 전부 **아니오**면 기본 버전.

---

## 절대 규칙

1. **모든 Test Case는 구체적이어야 한다.** `<유효한 입력>` 같은 애매한 표현 금지.
   실제 값이나 realistic한 예시를 써야 한다.
2. **happy path는 무조건 포함.** 최소 하나.
3. **엣지 케이스** — 빈 입력, 0, null, 경계값 — 해당하면 포함.
4. **에러 케이스** — Unit이 throw를 선언한다면 최소 하나.
5. **Signature와 Test Cases가 타입적으로 맞아야 한다.** 타입 불일치는 설계 오류.
6. **Side Effects에 "none"이라고 적었으면 진짜 순수 함수여야 한다.** 테스트 가능성이
   의존하는 계약이다.
