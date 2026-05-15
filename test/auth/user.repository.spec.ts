import * as bcrypt from 'bcrypt';

import { InMemoryUserRepository } from '../../src/auth/user.repository';

describe('InMemoryUserRepository.findByEmail', () => {
  let repository: InMemoryUserRepository;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
  });

  it('returns dummy user for exact owner email', async () => {
    const user = await repository.findByEmail('owner@ozpos.test');

    expect(user).toMatchObject({
      id: 'dummy-user-1',
      email: 'owner@ozpos.test',
    });
    expect(user?.passwordHash).toEqual(expect.any(String));
    await expect(
      bcrypt.compare('password123!', user?.passwordHash ?? ''),
    ).resolves.toBe(true);
  });

  it('returns null for missing email', async () => {
    await expect(
      repository.findByEmail('missing@ozpos.test'),
    ).resolves.toBeNull();
  });

  it('returns null for different email casing', async () => {
    await expect(
      repository.findByEmail('OWNER@ozpos.test'),
    ).resolves.toBeNull();
  });
});
