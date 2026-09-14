import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from '../config/env';
import { findOrCreateGoogleUser } from '../modules/auth/auth.service';

passport.serializeUser((user: any, done) => done(null, user));
passport.deserializeUser((user: any, done) => done(null, user));

if (env.google.clientId && env.google.clientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.google.clientId,
        clientSecret: env.google.clientSecret,
        callbackURL: env.google.callbackUrl,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('Google account has no accessible email'));
          }
          const user = await findOrCreateGoogleUser({
            googleId: profile.id,
            email,
            fullName: profile.displayName || email.split('@')[0],
            avatarUrl: profile.photos?.[0]?.value,
          });
          done(null, user as unknown as Express.User);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
}

export default passport;
