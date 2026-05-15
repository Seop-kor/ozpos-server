import { UnauthorizedException } from '@nestjs/common';

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super('Invalid credentials');
  }
}

export class InvalidTokenException extends UnauthorizedException {
  constructor() {
    super('Invalid token');
  }
}
