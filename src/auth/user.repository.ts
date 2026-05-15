import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

export type User = {
  id: string;
  email: string;
  passwordHash: string;
};

@Injectable()
export class InMemoryUserRepository {
  private readonly users: User[] = [
    {
      id: 'dummy-user-1',
      email: 'owner@ozpos.test',
      passwordHash: bcrypt.hashSync('password123!', 10),
    },
  ];

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(
      this.users.find((user) => user.email === email) ?? null,
    );
  }
}
