import { normalizeWalletAddress, isValidStellarAddress } from '../walletUtils';

describe('Wallet Utilities', () => {
  describe('normalizeWalletAddress', () => {
    it('should convert address to uppercase', () => {
      const address = 'gabcdefghijklmnopqrstuvwxyz234567';
      expect(normalizeWalletAddress(address)).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    });

    it('should trim whitespace', () => {
      const address = '  GABCDEFGHIJKLMNOPQRSTUVWXYZ234567  ';
      expect(normalizeWalletAddress(address)).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    });

    it('should handle undefined or null', () => {
      expect(normalizeWalletAddress(undefined)).toBe('');
      expect(normalizeWalletAddress(null)).toBe('');
    });

    it('should return empty string for empty input', () => {
      expect(normalizeWalletAddress('')).toBe('');
    });
  });

  describe('isValidStellarAddress', () => {
    it('should return true for valid uppercase address', () => {
      const validAddress = 'G234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQ';
      expect(isValidStellarAddress(validAddress)).toBe(true);
    });

    it('should return true for valid lowercase address', () => {
      const validAddress = 'g234567abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopq';
      expect(isValidStellarAddress(validAddress)).toBe(true);
    });

    it('should return false for address not starting with G', () => {
      const invalidAddress = 'ADH36P55N6WQX3QJ6F7E3S2C7Z6Z5Q5X4Y3W2V1U0T9S8R7Q6P5O4N3M';
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it('should return false for address with invalid length', () => {
      const shortAddress = 'GDH36P55N6WQX3QJ6F7E3S2C7Z6Z5Q5X4Y3W2V1U0T9S8R7Q6P5O4N3';
      expect(isValidStellarAddress(shortAddress)).toBe(false);
    });

    it('should return false for address with invalid characters', () => {
      const invalidChars = 'GDH36P55N6WQX3QJ6F7E3S2C7Z6Z5Q5X4Y3W2V1U0T9S8R7Q6P5O4N3!';
      expect(isValidStellarAddress(invalidChars)).toBe(false);
    });

    it('should return false for undefined or null', () => {
      expect(isValidStellarAddress(undefined)).toBe(false);
      expect(isValidStellarAddress(null)).toBe(false);
    });
  });
});
