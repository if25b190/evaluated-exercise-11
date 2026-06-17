export function isValidEmail(email: string): boolean {
  const isEmailAValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!isEmailAValidEmail) {
    return false;
  }

  return true;
}
