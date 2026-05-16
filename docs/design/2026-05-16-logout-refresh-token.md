# 로그아웃 refresh token 설계 문서

**작성일:** 2026-05-16
**상태:** approved

## 1. 목적 (Why)

현재 인증 흐름은 로그인 시 refresh token을 저장하고, refresh token 재발급 시 저장된 토큰과 입력 토큰이 일치할 때만 새 토큰을 발급한다. 로그아웃 기능은 현재 기기에서 사용 중인 refresh token을 폐기하여 이후 token refresh를 막는 것을 목표로 한다.

클라이언트는 `logout` 성공 후 보관 중인 access token과 refresh token을 삭제한다. access token은 JWT 특성상 별도 blacklist가 없으면 만료 전까지 유효할 수 있으나, 현재 범위에서는 짧은 access token TTL과 refresh token 폐기로 처리한다.

## 2. 제약 (Constraints)

- 기존 GraphQL/NestJS resolver/service/repository 구조를 유지한다.
- access token 즉시 무효화, blacklist, 다중 기기 세션 테이블은 이번 범위에서 제외한다.
- 현재 `InMemoryRefreshTokenRepository`는 userId당 refresh token 1개만 저장하므로, 현재 기기 로그아웃은 "현재 저장된 refresh token 폐기"로 해석한다.
- 유효하지 않은 refresh token, 저장소에 없는 refresh token, 회전된 old refresh token은 모두 기존 인증 흐름과 동일하게 `InvalidTokenException`으로 실패 처리한다.
- `src/auth/dto`에서 하이픈을 포함한 파일명은 작업 중 camelCase 파일명으로 변경한다.
- AGENTS.md 지시에 따라 git 명령은 실행하지 않는다.

## 3. 성공 기준 (Definition of Done)

- `logout(input: RefreshTokenPayloadInput!): Boolean!` GraphQL mutation이 추가된다.
- 로그인 후 받은 refresh token으로 `logout` 호출 시 저장소에서 해당 refresh token이 삭제되고 `true`를 반환한다.
- 삭제된 refresh token으로 `refreshToken` 호출 시 `InvalidTokenException`이 발생한다.
- malformed token, access token, 저장소에 없는 refresh token, 회전된 old refresh token으로 `logout` 호출 시 `InvalidTokenException`이 발생한다.
- 기존 `refreshToken` mutation은 renamed input인 `RefreshTokenPayloadInput`을 사용한다.
- DTO 파일명 변경 후 모든 import가 갱신된다:
  - `src/auth/dto/auth-payload.object.ts` -> `src/auth/dto/authPayload.object.ts`
  - `src/auth/dto/refresh-token.input.ts` -> `src/auth/dto/refreshToken.input.ts`
- 관련 unit tests와 schema generation 검증이 통과한다.

## 4. 접근법 선택

**선택된 접근:** refresh token 기반 현재 기기 로그아웃

**이유:** 기존 시스템은 refresh token 저장소를 중심으로 token refresh 권한을 판단한다. 로그아웃도 같은 저장소에서 현재 refresh token을 삭제하면 가장 작은 변경으로 목적을 달성할 수 있고, 기존 `refreshToken`의 보안 정책과 에러 처리를 재사용할 수 있다.

**고려했으나 탈락한 대안:**

- 멱등 logout - 이미 폐기된 토큰도 성공 처리하면 클라이언트 UX는 단순해지지만, token reuse나 저장소 불일치 상황을 서버가 감지하기 어렵다.
- access token blacklist 포함 - 즉시 무효화가 가능하지만 blacklist 저장소와 access token 검증 경로가 필요해 현재 범위보다 크다.

## 5. 아키텍처

`AuthResolver`에 `logout(input: RefreshTokenPayloadInput): Promise<boolean>` mutation을 추가한다. 기존 `RefreshTokenInput`은 `RefreshTokenPayloadInput`으로 rename하여 `refreshToken` mutation과 `logout` mutation이 함께 사용하는 공용 input으로 만든다.

`AuthService.logout(refreshToken)`은 `TokenService.verifyRefreshToken`으로 JWT 자체를 검증하고 userId를 얻는다. 이후 `InMemoryRefreshTokenRepository.findByUserId(userId)`로 현재 저장된 토큰을 조회한다. 저장 토큰이 없거나 입력 token과 다르면 `InvalidTokenException`을 던진다. 일치하면 `deleteByUserId(userId)`로 저장 token을 삭제하고 `true`를 반환한다.

`InMemoryRefreshTokenRepository`에는 `deleteByUserId(userId): Promise<void>`를 추가한다. 저장 토큰이 없어도 repository delete 자체는 에러 없이 완료한다. 저장 토큰 없음에 대한 도메인 에러 판단은 `AuthService.logout`이 담당한다.

DTO 파일명 변경은 동작 변경과 분리된 mechanical rename으로 수행한다. 클래스명 변경이 필요한 것은 `RefreshTokenInput` -> `RefreshTokenPayloadInput`이며, `AuthPayloadObject` 클래스명은 유지한다.

## 6. Units (슈도코드)

## Unit: InMemoryRefreshTokenRepository.deleteByUserId

`deleteByUserId(userId: string) -> Promise<void>`  
지정 userId의 저장된 refresh token을 삭제한다. 순수 함수가 아니다.

**Cases:**
| given | expect |
|---|---|
| `dummy-user-1`에 `refresh-token-1` 저장 후 `deleteByUserId('dummy-user-1')` | `findByUserId('dummy-user-1')` returns `null` |
| 저장 토큰이 없는 `missing-user`에 `deleteByUserId('missing-user')` | 에러 없이 완료 |

Side effects: in-memory 저장소 쓰기
Dependencies: 없음

## Unit: AuthService.logout

**File:** `src/auth/auth.service.ts`  
**Test file:** `test/auth/auth.service.spec.ts`

**Signature:** `logout(refreshToken: string) -> Promise<boolean>`

**Types (필요 정의):**

- 기존 `InvalidTokenException` 사용

**Responsibility:** refresh token JWT를 검증하고, 저장소의 현재 refresh token과 일치하면 저장 토큰을 폐기해 현재 기기 로그아웃을 완료한다.

**Preconditions:**

- 입력은 클라이언트가 보관 중인 refresh token 문자열이다.
- refresh token 저장소는 userId당 현재 refresh token 1개를 저장한다.

**Postconditions:**

- 성공 시 해당 userId의 저장된 refresh token은 삭제된다.
- 성공 시 `true`를 반환한다.
- 실패 시 저장소 상태는 변경하지 않는다.

**Behavior (sequential):**

1. `tokenService.verifyRefreshToken(refreshToken)`을 호출해 `{ userId }`를 얻는다.
2. `refreshTokenRepository.findByUserId(userId)`로 저장 token을 조회한다.
3. 저장 token이 없으면 `InvalidTokenException`을 던진다.
4. 저장 token 값이 입력 refresh token과 다르면 `InvalidTokenException`을 던진다.
5. `refreshTokenRepository.deleteByUserId(userId)`를 호출한다.
6. `true`를 반환한다.

**Test Cases:**

- **happy path** - 로그인으로 저장된 refresh token을 폐기한다.  
  given: `login('owner@ozpos.test', 'password123!')`으로 받은 refresh token  
  expect: `logout(refreshToken)` returns `true`, `findByUserId('dummy-user-1')` returns `null`
- **logout 후 refresh 불가** - 폐기된 refresh token은 재발급에 사용할 수 없다.  
  given: 로그인 refresh token을 `logout(refreshToken)`으로 삭제  
  expect: `refreshToken(refreshToken)` throws `InvalidTokenException`
- **rotated old token 거부** - 회전된 이전 refresh token으로 logout할 수 없다.  
  given: 로그인 refresh token을 `refreshToken(refreshToken)`으로 회전한 뒤 old token으로 `logout(oldRefreshToken)` 호출  
  expect: throws `InvalidTokenException`
- **access token 거부** - access token은 logout input으로 사용할 수 없다.  
  given: 로그인 결과의 access token  
  expect: `logout(accessToken)` throws `InvalidTokenException`
- **malformed token 거부** - JWT가 아닌 문자열은 거부한다.  
  given: `logout('not-a-jwt-token-value')`  
  expect: throws `InvalidTokenException`
- **저장 토큰 없음 거부** - 유효한 refresh token이어도 저장소에 없으면 거부한다.  
  given: 같은 secret으로 `TokenService.generateAuthTokens('dummy-user-1')`를 호출해 만든 refresh token, 저장소에는 저장하지 않음  
  expect: `logout(refreshToken)` throws `InvalidTokenException`

**Error handling:**

- `verifyRefreshToken` 실패는 `InvalidTokenException`으로 전파한다.
- 저장 token 없음과 저장 token 불일치는 `InvalidTokenException`으로 처리한다.

**Side Effects:** refresh token 저장소 삭제
**Dependencies:** `TokenService.verifyRefreshToken`, `InMemoryRefreshTokenRepository.findByUserId`, `InMemoryRefreshTokenRepository.deleteByUserId`
**Used by:** `AuthResolver.logout`

## Unit: AuthResolver.logout

**File:** `src/auth/auth.resolver.ts`  
**Test file:** `test/auth/auth.resolver.spec.ts`

**Signature:** `logout(input: RefreshTokenPayloadInput) -> Promise<boolean>`

**Types (필요 정의):**

- `RefreshTokenPayloadInput = { refreshToken: string }`

**Responsibility:** GraphQL logout mutation 입력에서 refresh token 문자열을 꺼내 `AuthService.logout`에 위임한다.

**Preconditions:**

- GraphQL validation이 `input.refreshToken`을 문자열로 전달한다.

**Postconditions:**

- service 반환값을 그대로 반환한다.

**Behavior (sequential):**

1. `input.refreshToken`을 읽는다.
2. `authService.logout(input.refreshToken)`을 호출한다.
3. service 결과를 반환한다.

**Test Cases:**

- **delegates logout input** - resolver가 service에 refresh token 문자열을 위임한다.  
  given: `{ refreshToken: 'header.payload.signature' }`, service returns `true`  
  expect: resolver returns `true`, service called with `'header.payload.signature'`

**Error handling:**

- service에서 발생한 인증 예외는 resolver가 잡지 않고 Nest GraphQL로 전파한다.

**Side Effects:** GraphQL resolver 호출
**Dependencies:** `AuthService.logout`
**Used by:** GraphQL `logout` mutation

## Unit: RefreshTokenPayloadInput rename

**File:** `src/auth/dto/refreshToken.input.ts`  
**Test file:** `test/auth/auth.resolver.spec.ts`, schema generation

**Signature:** `class RefreshTokenPayloadInput { refreshToken: string }`

**Types (필요 정의):**

- `refreshToken: string`

**Responsibility:** refresh token 문자열을 받는 공용 GraphQL input으로, `refreshToken` mutation과 `logout` mutation이 함께 사용한다.

**Preconditions:**

- `refreshToken` 필드는 문자열이며 최소 길이 20 이상이다.

**Postconditions:**

- GraphQL schema에 `input RefreshTokenPayloadInput { refreshToken: String! }`가 생성된다.
- `refreshToken` mutation과 `logout` mutation이 같은 input type을 사용한다.

**Behavior (sequential):**

1. 기존 `RefreshTokenInput` 클래스를 `RefreshTokenPayloadInput`으로 rename한다.
2. 파일명을 `refresh-token.input.ts`에서 `refreshToken.input.ts`로 rename한다.
3. `AuthResolver`의 import와 parameter type을 갱신한다.

**Test Cases:**

- **schema exposes shared input** - schema가 공용 input type을 노출한다.  
  given: GraphQL schema generation  
  expect: `refreshToken(input: RefreshTokenPayloadInput!): AuthPayload!`, `logout(input: RefreshTokenPayloadInput!): Boolean!`

**Error handling:**

- class-validator 규칙은 기존 `RefreshTokenInput`과 동일하게 유지한다.

**Side Effects:** GraphQL schema type rename
**Dependencies:** `@nestjs/graphql`, `class-validator`
**Used by:** `AuthResolver.refreshToken`, `AuthResolver.logout`

## Unit: Auth DTO file rename

`renameDashedAuthDtoFiles() -> import paths updated`  
`src/auth/dto`에서 하이픈을 포함한 DTO 파일명을 camelCase로 변경하고 import를 갱신한다. 순수 함수가 아니다.

**Cases:**
| given | expect |
|---|---|
| `src/auth/dto/auth-payload.object.ts` 존재 | `src/auth/dto/authPayload.object.ts`로 변경되고 imports compile |
| `src/auth/dto/refresh-token.input.ts` 존재 | `src/auth/dto/refreshToken.input.ts`로 변경되고 imports compile |

Side effects: 파일 rename 및 import 갱신
Dependencies: TypeScript compiler/module resolution

## 7. Out of scope

- access token blacklist 또는 즉시 access token revoke
- DB 기반 refresh token persistence
- 사용자별 다중 기기 세션 목록
- 모든 기기 로그아웃
- 로그아웃 이벤트 감사 로그
