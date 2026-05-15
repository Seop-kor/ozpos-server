# 로그인 + Refresh JWT 설계 문서

**작성일:** 2026-05-10
**상태:** approved

## 1. 목적 (Why)

운영자가 이메일과 비밀번호로 로그인하면 OZ POS 서버가 access JWT와 refresh JWT를 발급한다. 이후 access token은 보호 API 인증에 사용할 수 있고, refresh token은 access token 만료 후 새 토큰 쌍을 재발급하는 데 사용한다.

이번 사이클은 로그인과 refresh 흐름만 다룬다. JWT Guard, 로그아웃, DB 연동은 다음 사이클에서 별도 설계한다.

## 2. 제약 (Constraints)

- 현재 프로젝트는 NestJS 11 + GraphQL code-first 구조를 사용한다.
- 로그인 API는 GraphQL Mutation으로만 노출한다.
- 현재 DB/유저 테이블이 없으므로 더미 유저와 in-memory refresh token 저장소로 구현한다.
- refresh token은 회전 방식으로 관리한다. refresh 성공 시 이전 refresh token은 무효화된다.
- access token은 서버 저장소에 보관하지 않는 stateless JWT로 둔다.
- `JWT_SECRET`은 필수 설정이다. 누락 시 토큰 발급/검증은 실패해야 한다.
- `@nestjs/jwt`, `bcrypt`, `class-validator`, `class-transformer` 의존성 추가가 필요하다.

## 3. 성공 기준 (Definition of Done)

- `login(input: LoginInput!): AuthPayload!` GraphQL Mutation이 동작한다.
- 유효한 이메일/비밀번호로 로그인하면 access token과 refresh token을 반환하고 refresh token을 저장한다.
- 존재하지 않는 이메일 또는 틀린 비밀번호는 동일한 `InvalidCredentialsException`으로 실패한다.
- `refreshToken(input: RefreshTokenInput!): AuthPayload!` GraphQL Mutation이 동작한다.
- 유효하고 현재 저장된 refresh token으로 요청하면 새 access/refresh token 쌍을 반환하고 저장소의 refresh token을 교체한다.
- 서명 오류, 만료, token type 불일치, 저장소 불일치, 재사용된 이전 refresh token은 동일한 `InvalidTokenException`으로 실패한다.
- DTO 검증은 `email` 형식, `password` 최소 8자, `refreshToken` 최소 20자를 검사한다.
- 설계 문서의 각 Unit에 대한 unit test가 작성되고 통과한다.

## 4. 접근법 선택

**선택된 접근:** `AuthModule` + repository 인터페이스 + in-memory 구현 + refresh token 회전

**이유:** 현재 DB가 없으므로 in-memory 구현으로 로그인 흐름을 검증하되, `UserRepository`와 `RefreshTokenRepository` 경계를 두어 나중에 DB/Redis 구현체로 교체할 수 있게 한다. NestJS 공식 패턴인 feature module, provider DI, GraphQL code-first DTO, `ValidationPipe` 기반 입력 검증과도 잘 맞는다.

**고려했으나 탈락한 대안:**
- `AuthService` 내부에 더미 계정과 token `Map` 직접 보관 — 가장 빠르지만 서비스가 저장소 책임까지 가져 DB 전환 시 다시 뜯어야 한다.
- 환경변수 단일 계정 + in-memory refresh 저장소 — 코드 내 더미 계정을 피할 수 있지만 이번 더미 데이터 요구에는 설정 관리가 더 늘어난다.
- stateless refresh token — 저장소가 필요 없지만 refresh token 탈취, 강제 무효화, 로그아웃 확장에 취약하다.

## 5. 아키텍처

### 5.1 구성요소

`src/auth/` 아래에 인증 전용 모듈을 둔다.

- `auth.module.ts`: Auth provider와 resolver 등록
- `auth.resolver.ts`: GraphQL Mutation `login`, `refreshToken` 노출
- `auth.service.ts`: 로그인/refresh 유스케이스 오케스트레이션
- `password.service.ts`: bcrypt 비밀번호 검증 담당
- `token.service.ts`: JWT access/refresh 발급 및 refresh 검증 담당
- `user.repository.ts`: user 조회 추상 provider와 in-memory 구현
- `refresh-token.repository.ts`: refresh token 저장소 추상 provider와 in-memory 구현
- `dto/login.input.ts`: `LoginInput`
- `dto/refresh-token.input.ts`: `RefreshTokenInput`
- `dto/auth-payload.object.ts`: `AuthPayload`
- `auth.exception.ts`: 인증 관련 예외

`AppModule`은 `AuthModule`을 import한다.

### 5.2 GraphQL 경계

```graphql
login(input: LoginInput!): AuthPayload!
refreshToken(input: RefreshTokenInput!): AuthPayload!
```

`LoginInput`:

- `email`: `@IsEmail()`
- `password`: `@IsString()`, `@MinLength(8)`

`RefreshTokenInput`:

- `refreshToken`: `@IsString()`, `@MinLength(20)`

`AuthPayload`:

- `accessToken: string`
- `refreshToken: string`

### 5.3 도메인 모델

더미 user는 인증 주체를 의미한다. `storeId`가 아니라 `userId`를 JWT subject로 사용해, 나중에 하나의 매장에 여러 사용자 계정이 생겨도 의미가 충돌하지 않게 한다.

```ts
type User = {
  id: string;
  email: string;
  passwordHash: string;
};

type RefreshTokenRecord = {
  userId: string;
  token: string;
  expiresAt: Date;
};
```

더미 user 예시:

```ts
{
  id: "dummy-user-1",
  email: "owner@ozpos.test",
  passwordHash: "password123!의 bcrypt 해시 문자열"
}
```

### 5.4 데이터 흐름

`login`:

1. `AuthResolver.login`이 `LoginInput`을 받는다.
2. `AuthService.login(email, password)`를 호출한다.
3. `UserRepository.findByEmail(email)`로 더미 user를 조회한다.
4. user가 없으면 `InvalidCredentialsException`을 던진다.
5. `PasswordService.verify(password, user.passwordHash)`가 `false`면 `InvalidCredentialsException`을 던진다.
6. `TokenService.generateAuthTokens(user.id)`로 access/refresh token을 발급한다.
7. `RefreshTokenRepository.save({ userId, token: refreshToken, expiresAt })`로 현재 refresh token을 저장 또는 교체한다.
8. `{ accessToken, refreshToken }`을 반환한다.

`refreshToken`:

1. `AuthResolver.refreshToken`이 refresh token 문자열을 받는다.
2. `TokenService.verifyRefreshToken(refreshToken)`으로 서명, 만료, token type을 검증하고 `{ userId }`를 얻는다.
3. `RefreshTokenRepository.findByUserId(userId)`로 저장된 현재 refresh token을 조회한다.
4. 저장된 record가 없거나 `record.token !== refreshToken`이면 `InvalidTokenException`을 던진다.
5. `TokenService.generateAuthTokens(userId)`로 새 token 쌍을 발급한다.
6. `RefreshTokenRepository.save({ userId, token: newRefreshToken, expiresAt })`로 refresh token을 교체한다.
7. 새 `{ accessToken, refreshToken }`을 반환한다.

### 5.5 예외와 설정

`InvalidCredentialsException`은 이메일 없음과 비밀번호 불일치를 구분하지 않는다.

`InvalidTokenException`은 refresh token의 서명 오류, 만료, type 불일치, 저장소 미존재, 저장소 token 불일치를 구분하지 않는다.

JWT 설정:

- `JWT_SECRET`: 필수. 누락 시 실패.
- `JWT_ACCESS_TTL`: 기본 `15m`
- `JWT_REFRESH_TTL`: 기본 `7d`

access token은 저장하지 않는다. 짧은 TTL의 stateless JWT로 두고, 향후 JWT Guard에서 서명/만료/claim을 검증한다. refresh token은 TTL이 길고 재발급 권한을 가지므로 서버 저장소에 보관하고 회전 검증에 사용한다.

## 6. Units (슈도코드)

### Unit: PasswordService.verify

`verify(plain: string, hash: string) → Promise<boolean>`  
bcrypt 해시와 평문 비밀번호가 일치하는지 반환한다. 순수 계산에 가까운 래퍼이며 외부 상태를 변경하지 않는다.

**Cases:**
| given | expect |
|---|---|
| `plain="password123!"`, `hash=bcryptHash("password123!")` | `true` |
| `plain="wrongpass"`, `hash=bcryptHash("password123!")` | `false` |
| `plain="password123!"`, `hash="not-a-bcrypt-hash"` | `false` |

Side effects: none
Dependencies: `bcrypt`

### Unit: TokenService.generateAuthTokens

**File:** `src/auth/token.service.ts`  
**Test file:** `src/auth/token.service.spec.ts`

**Signature:** `generateAuthTokens(userId: string) → Promise<AuthTokens>`

**Types:**
- `AuthTokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date }`
- JWT payload = `{ sub: string; type: "access" | "refresh"; iat: number; exp: number }`

**Responsibility:** 주어진 `userId`를 subject로 하는 access JWT와 refresh JWT를 발급한다. refresh token의 만료 시각은 저장소 기록에 사용할 수 있게 함께 반환한다.

**Preconditions:**
- `userId`는 비어 있지 않은 문자열이다.
- `JWT_SECRET`은 설정되어 있다.
- `JWT_ACCESS_TTL`은 없으면 `15m`을 사용한다.
- `JWT_REFRESH_TTL`은 없으면 `7d`를 사용한다.

**Postconditions:**
- access token payload는 `{ sub: userId, type: "access" }`를 포함한다.
- refresh token payload는 `{ sub: userId, type: "refresh" }`를 포함한다.
- `refreshExpiresAt`은 refresh token의 `exp` claim과 같은 시각이다.

**Behavior (sequential):**
1. `ConfigService.getOrThrow("JWT_SECRET")`으로 secret을 읽는다.
2. access TTL과 refresh TTL을 설정에서 읽고 없으면 기본값을 사용한다.
3. `JwtService.signAsync({ sub: userId, type: "access" }, { secret, expiresIn: accessTtl })`를 호출한다.
4. `JwtService.signAsync({ sub: userId, type: "refresh" }, { secret, expiresIn: refreshTtl })`를 호출한다.
5. refresh token을 decode해 `exp` claim을 Date로 변환한다.
6. `{ accessToken, refreshToken, refreshExpiresAt }`를 반환한다.

**Test Cases:**
- **happy path** — access/refresh token을 함께 발급한다  
  given: `userId="dummy-user-1"`, `JWT_SECRET="test-secret"`  
  expect: `accessToken`, `refreshToken`, `refreshExpiresAt`이 반환된다.
- **access payload** — access token claim을 올바르게 넣는다  
  given: `generateAuthTokens("dummy-user-1")` 결과의 access token  
  expect: decoded payload has `sub="dummy-user-1"` and `type="access"`
- **refresh payload** — refresh token claim을 올바르게 넣는다  
  given: `generateAuthTokens("dummy-user-1")` 결과의 refresh token  
  expect: decoded payload has `sub="dummy-user-1"` and `type="refresh"`
- **refresh expiresAt** — refresh 만료 시각을 반환한다  
  given: `generateAuthTokens("dummy-user-1")` 결과  
  expect: `refreshExpiresAt` epoch seconds equals refresh token `exp`
- **missing secret** — secret 누락은 실패한다  
  given: ConfigService has no `JWT_SECRET`  
  expect: throws

**Error handling:**
- `JWT_SECRET` 누락과 JWT 서명 실패는 원본 에러를 전파한다.

**Side Effects:** none
**Dependencies:** `JwtService`, `ConfigService`
**Used by:** `AuthService.login`, `AuthService.refreshToken`

### Unit: TokenService.verifyRefreshToken

**File:** `src/auth/token.service.ts`  
**Test file:** `src/auth/token.service.spec.ts`

**Signature:** `verifyRefreshToken(token: string) → Promise<{ userId: string }>`

**Types:**
- Verified result = `{ userId: string }`

**Responsibility:** refresh JWT의 서명, 만료, `type` claim을 검증하고 인증 주체인 `userId`를 반환한다.

**Preconditions:**
- `token`은 문자열이다.
- `JWT_SECRET`은 설정되어 있다.

**Postconditions:**
- 성공 시 `{ userId }`를 반환한다.
- 실패 시 원인을 노출하지 않고 `InvalidTokenException`을 던진다.

**Behavior (sequential):**
1. `ConfigService.getOrThrow("JWT_SECRET")`으로 secret을 읽는다.
2. `JwtService.verifyAsync(token, { secret })`으로 서명과 만료를 검증한다.
3. payload의 `type`이 `"refresh"`인지 확인한다.
4. payload의 `sub`가 비어 있지 않은 문자열인지 확인한다.
5. `{ userId: payload.sub }`를 반환한다.

**Test Cases:**
- **happy path** — refresh token은 통과한다  
  given: `generateAuthTokens("dummy-user-1")` 결과의 refresh token  
  expect: `{ userId: "dummy-user-1" }`
- **wrong type** — access token은 refresh로 사용할 수 없다  
  given: `generateAuthTokens("dummy-user-1")` 결과의 access token  
  expect: throws `InvalidTokenException`
- **invalid signature** — 다른 secret으로 서명된 token은 실패한다  
  given: JWT signed with `secret="other-secret"`  
  expect: throws `InvalidTokenException`
- **expired** — 만료된 refresh token은 실패한다  
  given: JWT signed with `expiresIn="-1s"` and `type="refresh"`  
  expect: throws `InvalidTokenException`
- **malformed** — JWT 형식이 아닌 문자열은 실패한다  
  given: `"not-a-jwt-token-value"`  
  expect: throws `InvalidTokenException`

**Error handling:**
- JWT 검증 에러, type 불일치, subject 누락은 모두 `InvalidTokenException`으로 변환한다.

**Side Effects:** none
**Dependencies:** `JwtService`, `ConfigService`, `InvalidTokenException`
**Used by:** `AuthService.refreshToken`

### Unit: InMemoryUserRepository.findByEmail

`findByEmail(email: string) → Promise<User | null>`  
더미 user 저장소에서 이메일과 정확히 일치하는 user를 조회한다. 저장소 상태를 변경하지 않는다.

**Cases:**
| given | expect |
|---|---|
| `email="owner@ozpos.test"` | `User { id: "dummy-user-1", email: "owner@ozpos.test", passwordHash: bcryptHash("password123!") }` |
| `email="missing@ozpos.test"` | `null` |
| `email="OWNER@ozpos.test"` | `null` |

Side effects: none
Dependencies: 없음

### Unit: InMemoryRefreshTokenRepository

**File:** `src/auth/refresh-token.repository.ts`  
**Test file:** `src/auth/refresh-token.repository.spec.ts`

**Signature:** `save(record: RefreshTokenRecord) → Promise<void>`, `findByUserId(userId: string) → Promise<RefreshTokenRecord | null>`

**Types:**
- `RefreshTokenRecord = { userId: string; token: string; expiresAt: Date }`

**Responsibility:** in-memory `Map<userId, RefreshTokenRecord>`로 user별 현재 refresh token 하나를 저장하고 조회한다. `save`는 create와 replace를 모두 수행한다.

**Preconditions:**
- repository 인스턴스는 테스트마다 새로 생성된다.
- `record.userId`와 `record.token`은 비어 있지 않은 문자열이다.

**Postconditions:**
- `save` 성공 후 같은 `userId`로 조회하면 마지막으로 저장한 record를 반환한다.
- 없는 `userId`는 `null`을 반환한다.

**Behavior (sequential):**
1. `save(record)`는 `Map.set(record.userId, record)`를 호출한다.
2. `findByUserId(userId)`는 `Map.get(userId) ?? null`을 반환한다.

**Test Cases:**
- **save new** — 새 user의 refresh token을 저장한다  
  given: `save({ userId: "dummy-user-1", token: "refresh-token-1", expiresAt: date1 })`  
  expect: `findByUserId("dummy-user-1")` returns same record
- **replace existing** — 같은 user의 refresh token을 교체한다  
  given: saved token `"refresh-token-1"`, then save token `"refresh-token-2"`  
  expect: `findByUserId("dummy-user-1").token === "refresh-token-2"`
- **not found** — 없는 user는 null이다  
  given: empty repository  
  expect: `findByUserId("missing-user") === null`

**Error handling:**
- 이번 사이클에서 repository 자체 예외는 정의하지 않는다.

**Side Effects:** in-memory `Map` 쓰기
**Dependencies:** 없음
**Used by:** `AuthService.login`, `AuthService.refreshToken`

### Unit: AuthService.login

**File:** `src/auth/auth.service.ts`  
**Test file:** `src/auth/auth.service.spec.ts`

**Signature:** `login(email: string, password: string) → Promise<AuthPayload>`

**Types:**
- `AuthPayload = { accessToken: string; refreshToken: string }`

**Responsibility:** 이메일/비밀번호를 검증하고 인증 성공 시 access/refresh token 쌍을 발급한 뒤 현재 refresh token을 저장한다.

**Preconditions:**
- `email`과 `password`는 GraphQL DTO 검증을 통과했다.
- `password`는 최소 8자다.

**Postconditions:**
- 성공 시 user별 refresh token 저장소에는 반환된 refresh token이 현재 token으로 저장된다.
- 실패 시 refresh token 저장소 상태는 변경되지 않는다.

**Behavior (sequential):**
1. `UserRepository.findByEmail(email)`을 호출한다.
2. user가 없으면 `InvalidCredentialsException`을 던진다.
3. `PasswordService.verify(password, user.passwordHash)`를 호출한다.
4. 검증 결과가 `false`면 `InvalidCredentialsException`을 던진다.
5. `TokenService.generateAuthTokens(user.id)`를 호출한다.
6. `RefreshTokenRepository.save({ userId: user.id, token: refreshToken, expiresAt: refreshExpiresAt })`를 호출한다.
7. `{ accessToken, refreshToken }`을 반환한다.

**Test Cases:**
- **happy path** — 유효한 자격증명으로 로그인한다  
  given: `email="owner@ozpos.test"`, `password="password123!"`  
  expect: returns `{ accessToken, refreshToken }` and repository stores returned refresh token for `"dummy-user-1"`
- **unknown email** — 없는 이메일은 실패한다  
  given: `email="missing@ozpos.test"`, `password="password123!"`  
  expect: throws `InvalidCredentialsException` and refresh repository remains empty
- **wrong password** — 비밀번호 불일치는 실패한다  
  given: `email="owner@ozpos.test"`, `password="wrongpass"`  
  expect: throws `InvalidCredentialsException` and refresh repository remains empty
- **re-login rotates current refresh** — 다시 로그인하면 현재 refresh token을 교체한다  
  given: first `login("owner@ozpos.test", "password123!")`, then second login with same credentials  
  expect: repository token equals second response refresh token and does not equal first response refresh token

**Error handling:**
- 이메일 없음과 비밀번호 불일치는 모두 `InvalidCredentialsException`으로 통일한다.

**Side Effects:** `RefreshTokenRepository` 쓰기
**Dependencies:** `UserRepository`, `PasswordService`, `TokenService`, `RefreshTokenRepository`
**Used by:** `AuthResolver.login`

### Unit: AuthService.refreshToken

**File:** `src/auth/auth.service.ts`  
**Test file:** `src/auth/auth.service.spec.ts`

**Signature:** `refreshToken(refreshToken: string) → Promise<AuthPayload>`

**Types:**
- `AuthPayload = { accessToken: string; refreshToken: string }`

**Responsibility:** refresh token을 검증하고, 저장소에 기록된 현재 token과 일치할 때만 새 access/refresh token 쌍을 발급한다. 성공 시 refresh token은 회전된다.

**Preconditions:**
- `refreshToken`은 GraphQL DTO 검증을 통과한 최소 20자 문자열이다.

**Postconditions:**
- 성공 시 저장소의 refresh token은 새 refresh token으로 교체된다.
- 실패 시 저장소 상태는 변경되지 않는다.

**Behavior (sequential):**
1. `TokenService.verifyRefreshToken(refreshToken)`을 호출해 `{ userId }`를 얻는다.
2. `RefreshTokenRepository.findByUserId(userId)`를 호출한다.
3. record가 없으면 `InvalidTokenException`을 던진다.
4. `record.token !== refreshToken`이면 `InvalidTokenException`을 던진다.
5. `TokenService.generateAuthTokens(userId)`를 호출한다.
6. `RefreshTokenRepository.save({ userId, token: newRefreshToken, expiresAt: newRefreshExpiresAt })`를 호출한다.
7. `{ accessToken, refreshToken: newRefreshToken }`을 반환한다.

**Test Cases:**
- **happy path** — 저장된 refresh token으로 새 token 쌍을 발급한다  
  given: login result refresh token `token1`  
  expect: `refreshToken(token1)` returns new tokens and repository stores new refresh token
- **reused token** — 회전 후 이전 refresh token은 실패한다  
  given: `refreshToken(token1)` returns `token2`, then call `refreshToken(token1)` again  
  expect: throws `InvalidTokenException`
- **new token after rotation** — 회전 후 새 refresh token은 사용할 수 있다  
  given: `refreshToken(token1)` returns `token2`, then call `refreshToken(token2)`  
  expect: returns another new token pair
- **no stored token** — 저장소에 현재 token이 없으면 실패한다  
  given: valid refresh JWT for `"dummy-user-1"` but repository is empty  
  expect: throws `InvalidTokenException`
- **wrong token type** — access token으로 refresh 요청하면 실패한다  
  given: login result access token  
  expect: throws `InvalidTokenException`
- **malformed token** — JWT가 아닌 문자열은 실패한다  
  given: `"not-a-jwt-token-value"`  
  expect: throws `InvalidTokenException`

**Error handling:**
- token 검증 실패, 저장소 미존재, 저장소 token 불일치는 모두 `InvalidTokenException`으로 통일한다.

**Side Effects:** 성공 시 `RefreshTokenRepository` 쓰기
**Dependencies:** `TokenService`, `RefreshTokenRepository`, `InvalidTokenException`
**Used by:** `AuthResolver.refreshToken`

### Unit: AuthResolver

`login(input: LoginInput) → Promise<AuthPayload>`, `refreshToken(input: RefreshTokenInput) → Promise<AuthPayload>`  
GraphQL Mutation을 정의하고 `AuthService`로 위임한다. resolver 자체에는 분기 로직을 두지 않는다.

**Cases:**
| given | expect |
|---|---|
| `login({ email: "owner@ozpos.test", password: "password123!" })` | calls `AuthService.login("owner@ozpos.test", "password123!")` |
| `refreshToken({ refreshToken: "header.payload.signature" })` | calls `AuthService.refreshToken("header.payload.signature")` |

Side effects: `AuthService` 호출을 통한 간접 side effect 가능
Dependencies: `AuthService`

## 7. Out of scope

- 실제 DB 연동
- JWT Guard와 보호 API 인증
- access token 저장소 또는 블랙리스트
- 로그아웃 mutation
- 회원가입, 비밀번호 변경, 비밀번호 재설정
- 매장/권한/role 모델링
- refresh token 다중 세션 관리
- rate limiting, brute force 방어
- GraphQL e2e 테스트
