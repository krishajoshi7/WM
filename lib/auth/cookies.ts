export const authCookieNames = {
  accessToken: "secg-access-token",
  refreshToken: "secg-refresh-token",
  devRole: "secg-dev-role"
} as const;

export const authCookieMaxAgeSeconds = 60 * 60 * 24 * 7;
