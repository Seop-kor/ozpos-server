# SMS OTP 회원가입 설계 문서

**작성일:** 2026-05-10
**상태:** draft

## 1. 목적 (Why)

사용자가 이름, 전화번호, 이메일, 비밀번호를 입력하면 서버가 Aligo API를 통해 전화번호로 인증번호를 발송한다. 사용자가 인증번호를 다시 입력해야만 계정 상태가 `pending`에서 `active`로 바뀌고, 가입 완료와 동시에 access token과 refresh token을 발급받는다.

이번 사이클은 GraphQL 기반 회원가입 시작/완료 흐름과 in-memory 저장소 구현만 다룬다. 실제 DB, Redis, 재시도 제한, SMS 발송량 제한, 약관 동의 저장은 별도 설계로 미룬다.

## 2. 제약 (Constraints)

- 현재 프로젝트는 NestJS 11 + GraphQL code-first 구조를 사용한다.
- Auth 모듈은 현재 in-memory user repository와 refresh token repository를 사용한다.
- SMS 발송은 이미 존재하는 `SmsService.sendOtp(phone, otp)`를 사용한다.
- 회원가입 API는 GraphQL Mutation으로 노출한다.
- 가입 완료 후 자동 로그인 처리하여 기존 `AuthPayload`를 반환한다.
- 이메일과 전화번호는 `active` 유저 기준으로 모두 유니크해야 한다.
- OTP는 6자리 숫자 문자열이며 5분 후 만료된다.
- 같은 이메일 또는 전화번호의 `pending` 유저가 재요청하면 기존 pending 유저를 갱신하고 같은 `userId`를 반환한다.
- 이메일과 전화번호가 서로 다른 pending 유저에 각각 매칭되는 충돌 상황은 `DuplicateUserException`으로 실패시킨다.
- OTP는 해시하지 않고 in-memory user record에 평문으로 저장한다.
- 유저 상태는 `pending | active`를 사용한다.
- AGENTS.md 지시에 따라 git 명령은 실행하지 않는다.

## 3. 성공 기준 (Definition of Done)

- `requestSignup(input: RequestSignupInput!): RequestSignupPayload!` GraphQL Mutation이 동작한다.
- `requestSignup`은 이름, 전화번호, 이메일, 비밀번호를 받아 pending 유저를 저장하고 SMS OTP를 발송한다.
- active 상태의 같은 이메일 또는 전화번호가 있으면 회원가입 시작이 실패한다.
- pending 상태의 같은 이메일 또는 전화번호가 있으면 가입 정보, 비밀번호 해시, OTP, 만료시간을 교체하고 같은 `userId`를 반환한다.
- 이메일과 전화번호가 서로 다른 pending 유저에 각각 걸리는 충돌 요청은 실패한다.
- SMS 발송 실패 시 `SignupSmsFailedException`으로 실패한다. 이미 저장/갱신된 pending 유저는 롤백하지 않는다.
- `completeSignup(input: CompleteSignupInput!): AuthPayload!` GraphQL Mutation이 동작한다.
- 유효한 `userId`와 OTP로 가입을 완료하면 유저 상태가 `active`가 되고 OTP 필드가 비워진다.
- 가입 완료 후 access token과 refresh token을 반환하고 refresh token 저장소에 현재 refresh token을 저장한다.
- 없는 userId, active 유저, 틀린 OTP, 만료 OTP는 `InvalidSignupOtpException`으로 실패한다.
- `login`은 `active` 유저만 허용한다. pending 유저는 기존과 동일하게 `InvalidCredentialsException`으로 실패한다.
- DTO 검증은 `name`, `phone`, `email`, `password`, `userId`, `otp` 입력을 검사한다.
- 설계 문서의 각 Unit에 대한 unit test가 작성되고 통과한다.

## 4. 접근법 선택

**선택된 접근:** AuthModule 내부 2단계 signup + status 기반 in-memory user 저장소

**이유:** 사용자가 제안한 대로 `requestSignup`에서 pending 유저를 먼저 만들고 `completeSignup`에서 같은 `userId`의 OTP를 검증해 `active`로 전환하면, 회원가입 진행 상태가 user 도메인 안에 명확히 표현된다. 현재 코드의 in-memory repository 패턴과도 잘 맞고, 나중에 DB로 옮길 때도 user status와 OTP 필드를 테이블/별도 검증 테이블로 자연스럽게 분리할 수 있다.

**고려했으나 탈락한 대안:**
- 별도 `PendingSignupRepository` 사용 — 가입 전 임시 데이터와 유저 데이터를 분리할 수 있지만, 현재 in-memory 단계에서는 저장소가 늘어나고 상태 전환 모델이 덜 직관적이다.
- 전화번호 OTP 전용 저장소 + signup 시 전체 입력 재전송 — 임시 저장 데이터가 적지만 API 사용성이 나쁘고 사용자가 가입 정보를 두 번 보내야 한다.
- DB/Redis 기반 운영형 설계 — 실제 운영 구조에 가깝지만 현재 프로젝트의 in-memory 인증 사이클보다 범위가 커진다.

## 5. 아키텍처

### 5.1 GraphQL 경계

새 Mutation:

```graphql
requestSignup(input: RequestSignupInput!): RequestSignupPayload!
completeSignup(input: CompleteSignupInput!): AuthPayload!
```

`RequestSignupInput`:

- `name`: `@IsString()`, `@MinLength(1)`
- `phone`: `@IsString()`, `@MinLength(10)`
- `email`: `@IsEmail()`
- `password`: `@IsString()`, `@MinLength(8)`

`RequestSignupPayload`:

- `userId: string`

`CompleteSignupInput`:

- `userId`: `@IsString()`, `@MinLength(1)`
- `otp`: `@IsString()`, `@Matches(/^\d{6}$/)`

새 파일명은 기존 `refreshToken.repository.ts` 스타일에 맞춰 camelCase를 사용한다.

- `requestSignup.input.ts`
- `requestSignupPayload.object.ts`
- `completeSignup.input.ts`
- `otp.service.ts`

### 5.2 도메인 모델

`User` 모델을 가입 상태를 포함하도록 확장한다.

```ts
type UserStatus = 'pending' | 'active';

type User = {
  id: string;
  name: string;
  phone: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  otp: string | null;
  otpExpiresAt: Date | null;
};
```

기존 더미 유저는 `active` 상태와 이름/전화번호를 가진 형태로 보강한다.

### 5.3 구성요소 책임

- `AuthResolver`: GraphQL mutation 입력을 받고 `AuthService`에 위임한다.
- `AuthService`: `requestSignup`, `completeSignup`, `login`, `refreshToken` 유스케이스를 조립한다.
- `InMemoryUserRepository`: user 조회, 중복 확인, pending 저장/갱신, active 전환을 담당한다.
- `PasswordService`: 비밀번호 해시 생성과 검증을 담당한다.
- `OtpService`: 6자리 OTP 생성, 만료시간 계산, OTP 검증을 담당한다.
- `SmsService`: Aligo API로 OTP 문자를 발송한다.
- `TokenService`: 가입 완료 후 기존 로그인과 같은 방식으로 JWT를 발급한다.
- `InMemoryRefreshTokenRepository`: 가입 완료 후 refresh token 저장을 담당한다.

`AuthModule`은 `CommonModule`을 import해서 `SmsService`를 주입받는다.

### 5.4 데이터 흐름

`requestSignup`:

1. `AuthResolver.requestSignup`이 `RequestSignupInput`을 받는다.
2. `AuthService.requestSignup(name, phone, email, password)`를 호출한다.
3. `UserRepository.findActiveByEmailOrPhone(email, phone)`으로 active 중복을 확인한다.
4. 중복이면 `DuplicateUserException`을 던진다.
5. `PasswordService.hash(password)`로 비밀번호 해시를 만든다.
6. `OtpService.generate()`로 OTP와 5분 만료시간을 만든다.
7. `UserRepository.findPendingByEmailOrPhone(email, phone)`으로 재요청 대상 pending 유저들을 찾는다.
8. 이메일 매칭 pending 유저와 전화번호 매칭 pending 유저가 서로 다른 유저이면 `DuplicateUserException`을 던진다.
9. pending 유저가 있으면 이름, 전화번호, 이메일, 비밀번호 해시, OTP, 만료시간을 갱신한다.
10. pending 유저가 없으면 새 `pending` 유저를 저장한다.
11. `SmsService.sendOtp(phone, otp)`를 호출한다.
12. SMS 발송 실패 시 `SignupSmsFailedException`을 던진다. 저장/갱신은 롤백하지 않는다.
13. `{ userId }`를 반환한다.

`completeSignup`:

1. `AuthResolver.completeSignup`이 `CompleteSignupInput`을 받는다.
2. `AuthService.completeSignup(userId, otp)`를 호출한다.
3. `UserRepository.findById(userId)`로 유저를 조회한다.
4. 유저가 없거나 `status !== 'pending'`이면 `InvalidSignupOtpException`을 던진다.
5. `OtpService.verify(otp, user.otp, user.otpExpiresAt, now)`로 OTP를 검증한다.
6. OTP가 틀렸거나 만료됐으면 `InvalidSignupOtpException`을 던진다.
7. `UserRepository.activate(userId)`로 유저 상태를 `active`로 바꾸고 OTP 필드를 비운다.
8. `TokenService.generateAuthTokens(userId)`로 token 쌍을 발급한다.
9. `RefreshTokenRepository.save(...)`로 refresh token을 저장한다.
10. `{ accessToken, refreshToken }`을 반환한다.

`login`:

1. 이메일로 유저를 찾는다.
2. 유저가 없거나 `status !== 'active'`이면 `InvalidCredentialsException`을 던진다.
3. 비밀번호 검증 이후 기존 흐름과 동일하게 token을 발급한다.

### 5.5 예외와 SMS 실패 정책

- `DuplicateUserException`: 같은 이메일 또는 전화번호의 active 유저가 있거나, 이메일과 전화번호가 서로 다른 pending 유저에 매칭될 때 사용한다.
- `InvalidSignupOtpException`: userId 없음, active 유저, OTP 없음, OTP 불일치, OTP 만료를 동일하게 처리한다.
- `SignupSmsFailedException`: `SmsService.sendOtp`가 실패하거나 `false`를 반환할 때 사용한다.
- `InvalidCredentialsException`: 로그인 실패와 pending 유저 로그인 시도를 동일하게 처리한다.

SMS 실패 시 이미 저장 또는 갱신된 pending 유저는 롤백하지 않는다. 다음 `requestSignup` 재요청이 같은 pending 유저를 갱신한다.

## 6. Units (슈도코드)

### Unit: PasswordService.hash

`hash(plain: string) -> Promise<string>`  
평문 비밀번호를 bcrypt 해시 문자열로 변환한다. 순수 함수는 아니지만 외부 저장소 상태를 변경하지 않는다.

**Cases:**
| given | expect |
|---|---|
| `plain="password123!"` | returns bcrypt hash string not equal to plain |
| returned hash from `plain="password123!"`, then `verify("password123!", hash)` | `true` |
| returned hash from `plain="password123!"`, then `verify("wrongpass", hash)` | `false` |

Side effects: CPU-bound bcrypt work
Dependencies: `bcrypt`

### Unit: OtpService.generate

`generate(now: Date) -> { otp: string; expiresAt: Date }`  
6자리 숫자 OTP와 5분 뒤 만료시각을 생성한다. 난수에 의존하지만 외부 상태를 변경하지 않는다.

**Cases:**
| given | expect |
|---|---|
| `now=2026-05-10T12:00:00.000Z` | `otp` matches `/^\d{6}$/` |
| `now=2026-05-10T12:00:00.000Z` | `expiresAt=2026-05-10T12:05:00.000Z` |
| random number source returns `42`, `now=2026-05-10T12:00:00.000Z` | `otp="000042"` |

Side effects: none
Dependencies: random number source

### Unit: OtpService.verify

`verify(inputOtp: string, storedOtp: string | null, expiresAt: Date | null, now: Date) -> boolean`  
저장된 OTP가 존재하고 만료되지 않았으며 입력 OTP와 일치하는지 반환한다. 순수 함수.

**Cases:**
| given | expect |
|---|---|
| `inputOtp="123456"`, `storedOtp="123456"`, `expiresAt=2026-05-10T12:05:00.000Z`, `now=2026-05-10T12:04:00.000Z` | `true` |
| `inputOtp="000000"`, `storedOtp="123456"`, `expiresAt=2026-05-10T12:05:00.000Z`, `now=2026-05-10T12:04:00.000Z` | `false` |
| `inputOtp="123456"`, `storedOtp="123456"`, `expiresAt=2026-05-10T12:05:00.000Z`, `now=2026-05-10T12:05:01.000Z` | `false` |
| `inputOtp="123456"`, `storedOtp=null`, `expiresAt=2026-05-10T12:05:00.000Z`, `now=2026-05-10T12:04:00.000Z` | `false` |
| `inputOtp="123456"`, `storedOtp="123456"`, `expiresAt=null`, `now=2026-05-10T12:04:00.000Z` | `false` |

Side effects: none
Dependencies: 없음

### Unit: InMemoryUserRepository.findActiveByEmailOrPhone

`findActiveByEmailOrPhone(email: string, phone: string) -> Promise<User | null>`  
active 상태인 유저 중 이메일 또는 전화번호가 일치하는 유저를 찾는다. 저장소 상태를 변경하지 않는다.

**Cases:**
| given | expect |
|---|---|
| active user has `email="owner@ozpos.test"` | returns user for `email="owner@ozpos.test"`, `phone="01099999999"` |
| active user has `phone="01012345678"` | returns user for `email="new@ozpos.test"`, `phone="01012345678"` |
| only pending user has same email | returns `null` |
| no matching email or phone | returns `null` |

Side effects: none
Dependencies: in-memory users array

### Unit: InMemoryUserRepository.findById

`findById(userId: string) -> Promise<User | null>`  
id가 일치하는 유저를 찾는다. 저장소 상태를 변경하지 않는다.

**Cases:**
| given | expect |
|---|---|
| stored user has `id="dummy-user-1"` | returns that user |
| no stored user has `id="missing-user"` | returns `null` |
| stored user is pending | returns pending user without status filtering |

Side effects: none
Dependencies: in-memory users array

### Unit: InMemoryUserRepository.findPendingByEmailOrPhone

`findPendingByEmailOrPhone(email: string, phone: string) -> Promise<User[]>`  
pending 상태인 유저 중 이메일 또는 전화번호가 일치하는 유저들을 찾는다. 저장소 상태를 변경하지 않는다.

**Cases:**
| given | expect |
|---|---|
| pending user has `email="new@ozpos.test"` | returns `[user]` for `email="new@ozpos.test"`, `phone="01099999999"` |
| pending user has `phone="01011112222"` | returns `[user]` for `email="other@ozpos.test"`, `phone="01011112222"` |
| two pending users match email and phone separately | returns both users |
| only active user has same email | returns `[]` |
| no matching email or phone | returns `[]` |

Side effects: none
Dependencies: in-memory users array

### Unit: InMemoryUserRepository.save

**File:** `src/auth/user.repository.ts`  
**Test file:** `test/auth/user.repository.spec.ts`

**Signature:** `save(user: User) -> Promise<User>`

**Types:**
- `UserStatus = 'pending' | 'active'`
- `User = { id: string; name: string; phone: string; email: string; passwordHash: string; status: UserStatus; otp: string | null; otpExpiresAt: Date | null }`

**Responsibility:** 새 유저를 in-memory 저장소에 추가하거나 같은 id의 기존 유저를 교체한다.

**Preconditions:**
- `user.id`는 비어 있지 않은 문자열이다.
- 중복 정책은 호출자가 검사한다.

**Postconditions:**
- 같은 id의 유저가 없으면 새 유저가 추가된다.
- 같은 id의 유저가 있으면 새 값으로 교체된다.
- 반환값은 저장된 유저다.

**Behavior (sequential):**
1. 저장소에서 `user.id`와 같은 유저의 index를 찾는다.
2. index가 없으면 users 배열에 추가한다.
3. index가 있으면 해당 위치를 전달받은 user로 교체한다.
4. 저장된 user를 반환한다.

**Test Cases:**
- **create** — 새 pending 유저를 저장한다  
  given: empty custom repository, `save({ id: "user-1", status: "pending", ... })`  
  expect: `findById("user-1")` returns saved user
- **replace** — 같은 id 유저를 교체한다  
  given: stored user `id="user-1"`, call `save` with same id and changed phone  
  expect: `findById("user-1")` returns changed phone and only one matching id exists

**Error handling:**
- 별도 예외를 던지지 않는다.

**Side Effects:** in-memory users array write
**Dependencies:** 없음
**Used by:** `AuthService.requestSignup`

### Unit: InMemoryUserRepository.activate

**File:** `src/auth/user.repository.ts`  
**Test file:** `test/auth/user.repository.spec.ts`

**Signature:** `activate(userId: string) -> Promise<User | null>`

**Types:**
- 외부 정의된 `User` 사용

**Responsibility:** pending 유저를 active로 전환하고 OTP 필드를 비운다.

**Preconditions:**
- `userId`는 비어 있지 않은 문자열이다.
- 상태 검증은 호출자가 수행한다.

**Postconditions:**
- 유저가 있으면 `status="active"`, `otp=null`, `otpExpiresAt=null`로 저장된다.
- 유저가 없으면 `null`을 반환한다.

**Behavior (sequential):**
1. `userId`로 유저를 찾는다.
2. 없으면 `null`을 반환한다.
3. 유저를 복사해 `status`를 `active`로 변경한다.
4. `otp`와 `otpExpiresAt`을 `null`로 변경한다.
5. 저장소에 교체 저장한다.
6. 변경된 user를 반환한다.

**Test Cases:**
- **happy path** — pending 유저를 active로 전환한다  
  given: pending user with `otp="123456"`  
  expect: returned user has `status="active"`, `otp=null`, `otpExpiresAt=null`
- **not found** — 없는 userId  
  given: no user with `id="missing-user"`  
  expect: returns `null`

**Error handling:**
- 없는 userId는 `null`로 표현한다.

**Side Effects:** in-memory users array write
**Dependencies:** 없음
**Used by:** `AuthService.completeSignup`

### Unit: AuthService.requestSignup

**File:** `src/auth/auth.service.ts`  
**Test file:** `test/auth/auth.service.spec.ts`

**Signature:** `requestSignup(name: string, phone: string, email: string, password: string) -> Promise<{ userId: string }>`

**Types:**
- `RequestSignupResult = { userId: string }`

**Responsibility:** 회원가입 시작 요청을 처리한다. active 중복을 막고, pending 유저를 생성 또는 갱신하고, SMS OTP를 발송한다.

**Preconditions:**
- DTO 검증을 통과한 값이 전달된다.
- `SmsService`는 `sendOtp(phone, otp)`를 제공한다.

**Postconditions:**
- 성공 시 pending 유저가 저장되어 있고 SMS 발송이 시도된다.
- active 중복이 있으면 저장소를 변경하지 않는다.
- SMS 실패 시 pending 저장/갱신은 남아 있고 예외가 반환된다.

**Behavior (sequential):**
1. `userRepository.findActiveByEmailOrPhone(email, phone)`을 호출한다.
2. active 중복 유저가 있으면 `DuplicateUserException`을 던진다.
3. `passwordService.hash(password)`를 호출한다.
4. `otpService.generate(new Date())`를 호출한다.
5. `userRepository.findPendingByEmailOrPhone(email, phone)`을 호출한다.
6. pending 매칭 결과의 고유 id가 2개 이상이면 `DuplicateUserException`을 던진다.
7. pending 유저가 1개 있으면 같은 `id`로 이름, 전화번호, 이메일, 비밀번호 해시, OTP, 만료시간을 갱신한다.
8. pending 유저가 없으면 새 id를 가진 pending 유저 객체를 만든다.
9. `userRepository.save(user)`를 호출한다.
10. `smsService.sendOtp(phone, otp)`를 호출한다.
11. `sendOtp`가 `false`를 반환하거나 에러를 던지면 `SignupSmsFailedException`을 던진다.
12. `{ userId: user.id }`를 반환한다.

**Test Cases:**
- **new pending** — 신규 가입 요청은 pending 유저를 만들고 SMS를 보낸다  
  given: no matching user, input `("Kim", "01011112222", "new@ozpos.test", "password123!")`  
  expect: returns new `userId`, saved user has `status="pending"`, `smsService.sendOtp` called
- **pending resend** — pending 중복은 같은 userId를 갱신한다  
  given: pending user `id="pending-1"` with same email  
  expect: returns `userId="pending-1"` and saved user has changed phone/passwordHash/otp
- **pending collision** — 이메일과 전화번호가 서로 다른 pending 유저에 매칭되면 실패한다  
  given: pending user A has same email and pending user B has same phone  
  expect: throws `DuplicateUserException` and does not send SMS
- **active duplicate email** — active email 중복은 실패한다  
  given: active user with `email="owner@ozpos.test"`  
  expect: throws `DuplicateUserException` and does not send SMS
- **active duplicate phone** — active phone 중복은 실패한다  
  given: active user with `phone="01012345678"`  
  expect: throws `DuplicateUserException` and does not send SMS
- **sms failure** — SMS 실패는 가입 시작 실패로 처리한다  
  given: `smsService.sendOtp` rejects  
  expect: throws `SignupSmsFailedException` and pending user remains saved

**Error handling:**
- active 중복과 pending 충돌은 `DuplicateUserException`.
- SMS 실패는 원인을 감싸 `SignupSmsFailedException`.

**Side Effects:** in-memory user write, Aligo SMS API call through `SmsService`
**Dependencies:** `InMemoryUserRepository`, `PasswordService`, `OtpService`, `SmsService`
**Used by:** `AuthResolver.requestSignup`

### Unit: AuthService.completeSignup

**File:** `src/auth/auth.service.ts`  
**Test file:** `test/auth/auth.service.spec.ts`

**Signature:** `completeSignup(userId: string, otp: string) -> Promise<AuthPayload>`

**Types:**
- 기존 `AuthPayload = { accessToken: string; refreshToken: string }`

**Responsibility:** pending 유저의 OTP를 검증해 active로 전환하고 가입 완료 token을 발급한다.

**Preconditions:**
- DTO 검증을 통과한 `userId`, `otp`가 전달된다.
- JWT 설정은 기존 로그인과 동일하게 준비되어 있다.

**Postconditions:**
- 성공 시 유저는 active 상태가 되고 OTP 필드는 비워진다.
- 성공 시 refresh token 저장소에 새 refresh token이 저장된다.
- 실패 시 유저 상태와 refresh token 저장소는 변경되지 않는다.

**Behavior (sequential):**
1. `userRepository.findById(userId)`를 호출한다.
2. 유저가 없거나 `status !== "pending"`이면 `InvalidSignupOtpException`을 던진다.
3. `otpService.verify(otp, user.otp, user.otpExpiresAt, new Date())`를 호출한다.
4. 검증 결과가 `false`면 `InvalidSignupOtpException`을 던진다.
5. `userRepository.activate(userId)`를 호출한다.
6. `tokenService.generateAuthTokens(userId)`를 호출한다.
7. `refreshTokenRepository.save({ userId, token: refreshToken, expiresAt: refreshExpiresAt })`를 호출한다.
8. `{ accessToken, refreshToken }`을 반환한다.

**Test Cases:**
- **happy path** — 올바른 OTP는 가입 완료와 token 발급을 수행한다  
  given: pending user `id="pending-1"`, `otp="123456"`, not expired  
  expect: returns JWT pair, user status becomes active, refresh token stored
- **missing user** — 없는 userId는 실패한다  
  given: `userId="missing-user"`  
  expect: throws `InvalidSignupOtpException`
- **already active** — active 유저는 OTP 완료 대상이 아니다  
  given: active user `id="active-1"`  
  expect: throws `InvalidSignupOtpException`
- **wrong otp** — 틀린 OTP는 실패한다  
  given: pending user stores `otp="123456"`, input `otp="000000"`  
  expect: throws `InvalidSignupOtpException` and user remains pending
- **expired otp** — 만료된 OTP는 실패한다  
  given: pending user stores `expiresAt` before now  
  expect: throws `InvalidSignupOtpException` and user remains pending

**Error handling:**
- userId 없음, 상태 불일치, OTP 없음, OTP 불일치, OTP 만료는 모두 `InvalidSignupOtpException`.
- token 발급 실패는 원본 에러를 전파한다.

**Side Effects:** in-memory user write, in-memory refresh token write
**Dependencies:** `InMemoryUserRepository`, `OtpService`, `TokenService`, `InMemoryRefreshTokenRepository`
**Used by:** `AuthResolver.completeSignup`

### Unit: AuthService.login status check

**File:** `src/auth/auth.service.ts`  
**Test file:** `test/auth/auth.service.spec.ts`

**Signature:** `login(email: string, password: string) -> Promise<AuthPayload>`

**Types:**
- 기존 `AuthPayload` 사용

**Responsibility:** 기존 로그인 흐름에 active 상태 검증을 추가한다.

**Preconditions:**
- DTO 검증을 통과한 이메일과 비밀번호가 전달된다.

**Postconditions:**
- active 유저만 token을 발급받는다.
- pending 유저는 비밀번호가 맞아도 로그인할 수 없다.

**Behavior (sequential):**
1. 기존처럼 이메일로 유저를 조회한다.
2. 유저가 없으면 `InvalidCredentialsException`을 던진다.
3. 유저의 `status !== "active"`이면 `InvalidCredentialsException`을 던진다.
4. 기존처럼 비밀번호를 검증한다.
5. 기존처럼 token 발급과 refresh token 저장을 수행한다.

**Test Cases:**
- **active login** — active 유저는 기존처럼 로그인된다  
  given: active dummy user and valid password  
  expect: returns JWT pair
- **pending blocked** — pending 유저는 로그인할 수 없다  
  given: pending user with matching email/password  
  expect: throws `InvalidCredentialsException` and refresh store remains empty

**Error handling:**
- pending 상태는 `InvalidCredentialsException`으로 숨긴다.

**Side Effects:** successful login writes refresh token
**Dependencies:** `InMemoryUserRepository`, `PasswordService`, `TokenService`, `InMemoryRefreshTokenRepository`
**Used by:** `AuthResolver.login`

### Unit: AuthResolver signup mutations

**File:** `src/auth/auth.resolver.ts`  
**Test file:** `test/auth/auth.resolver.spec.ts`

**Signature:** GraphQL resolver methods

**Types:**
- `RequestSignupInput`
- `CompleteSignupInput`
- `RequestSignupPayload`
- `AuthPayload`

**Responsibility:** GraphQL mutation 입력을 `AuthService` 메서드에 정확히 위임한다.

**Preconditions:**
- Nest GraphQL이 DTO 인스턴스를 전달한다.

**Postconditions:**
- resolver는 비즈니스 로직을 수행하지 않는다.
- service 반환값을 그대로 반환한다.

**Behavior (sequential):**
1. `requestSignup(input)`은 `authService.requestSignup(input.name, input.phone, input.email, input.password)`를 호출한다.
2. `completeSignup(input)`은 `authService.completeSignup(input.userId, input.otp)`를 호출한다.
3. 각 service 결과를 그대로 반환한다.

**Test Cases:**
- **requestSignup delegates** — 가입 시작 입력을 service에 위임한다  
  given: input `{ name: "Kim", phone: "01011112222", email: "new@ozpos.test", password: "password123!" }`  
  expect: `authService.requestSignup` called with four scalar args and returns `{ userId }`
- **completeSignup delegates** — 가입 완료 입력을 service에 위임한다  
  given: input `{ userId: "pending-1", otp: "123456" }`  
  expect: `authService.completeSignup` called with `("pending-1", "123456")` and returns AuthPayload

**Error handling:**
- service 예외를 그대로 전파한다.

**Side Effects:** none directly
**Dependencies:** `AuthService`
**Used by:** GraphQL runtime

## 7. Out of scope

- 실제 DB 또는 Redis 저장소 구현
- OTP 발송 횟수 제한, 재시도 제한, IP rate limit
- OTP 해시 저장
- 약관 동의 입력과 저장
- SMS 발송 실패 롤백 또는 트랜잭션 처리
- 휴대폰 번호 국가코드/정규화
- 이메일 대소문자 정규화
- refresh token repository의 DB/Redis 전환
- GraphQL e2e 테스트
