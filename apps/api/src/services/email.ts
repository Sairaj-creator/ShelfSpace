export class EmailService {
  static async sendVerificationEmail(email: string, token: string): Promise<void> {
    try {
      console.log(`[Email Service] Verification link sent to ${email}: /verify-email?token=${token}`);
    } catch (err) {
      console.error(`[Email Service Failure] Failed to send verification email to ${email}`, err);
    }
  }

  static async sendInviteEmail(email: string, token: string): Promise<void> {
    try {
      console.log(`[Email Service] Staff invite sent to ${email}: /signup?invite=${token}`);
    } catch (err) {
      console.error(`[Email Service Failure] Failed to send invite email to ${email}`, err);
    }
  }

  static async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    try {
      console.log(`[Email Service] Password reset link sent to ${email}: /reset-password?token=${token}`);
    } catch (err) {
      console.error(`[Email Service Failure] Failed to send password reset email to ${email}`, err);
    }
  }
}
