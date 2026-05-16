import { InMemoryRefreshTokenRepository } from '../../src/auth/refreshToken.repository';

describe('InMemoryRefreshTokenRepository', () => {
  let repository: InMemoryRefreshTokenRepository;

  beforeEach(() => {
    repository = new InMemoryRefreshTokenRepository();
  });

  it('stores a refresh token for a new user', async () => {
    const record = {
      userId: 'dummy-user-1',
      token: 'refresh-token-1',
      expiresAt: new Date('2026-05-11T00:00:00.000Z'),
    };

    await repository.save(record);

    await expect(repository.findByUserId('dummy-user-1')).resolves.toEqual(
      record,
    );
  });

  it('replaces an existing refresh token for the same user', async () => {
    await repository.save({
      userId: 'dummy-user-1',
      token: 'refresh-token-1',
      expiresAt: new Date('2026-05-11T00:00:00.000Z'),
    });

    await repository.save({
      userId: 'dummy-user-1',
      token: 'refresh-token-2',
      expiresAt: new Date('2026-05-12T00:00:00.000Z'),
    });

    await expect(
      repository.findByUserId('dummy-user-1'),
    ).resolves.toMatchObject({
      token: 'refresh-token-2',
    });
  });

  it('returns null when user has no stored refresh token', async () => {
    await expect(repository.findByUserId('missing-user')).resolves.toBeNull();
  });

  it('deletes a stored refresh token for a user', async () => {
    await repository.save({
      userId: 'dummy-user-1',
      token: 'refresh-token-1',
      expiresAt: new Date('2026-05-11T00:00:00.000Z'),
    });

    await repository.deleteByUserId('dummy-user-1');

    await expect(repository.findByUserId('dummy-user-1')).resolves.toBeNull();
  });

  it('completes when deleting a user without a stored refresh token', async () => {
    await expect(
      repository.deleteByUserId('missing-user'),
    ).resolves.toBeUndefined();
  });
});
