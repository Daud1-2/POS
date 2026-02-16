import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { account } from '../services/appwrite';
import DoodleBackground from '../components/DoodleBackground';
import badge from '../assets/orderly-logo.png';

const WEB_AUTH_SESSION_KEY = 'posWebAuthActive';

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('Working...');
    try {
      // If already logged in, go to cashier
      try {
        await account.get();
        sessionStorage.setItem(WEB_AUTH_SESSION_KEY, '1');
        navigate('/cashier');
        return;
      } catch (err) {
        // Not logged in, continue
      }
      await account.createEmailPasswordSession({ email, password });
      setStatus('Signed in');
      sessionStorage.setItem(WEB_AUTH_SESSION_KEY, '1');
      navigate('/cashier');
    } catch (err) {
      sessionStorage.removeItem(WEB_AUTH_SESSION_KEY);
      setStatus('Credentials are incorrect');
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 relative overflow-hidden">
      <DoodleBackground />
      <main className="relative z-10 min-h-screen flex items-center justify-center px-4 py-10 sm:px-6 sm:py-12">
        <div className="w-full max-w-sm sm:max-w-md">
          <div className="flex items-center justify-center gap-3 text-slate-900 text-xl sm:text-2xl font-semibold mb-5 sm:mb-6">
            <img
              src={badge}
              alt="Orderly logo"
              className="h-10 w-10 sm:h-12 sm:w-12 object-contain"
            />
            Orderly
            <span className="text-slate-600 text-xs sm:text-sm -translate-y-1 sm:-translate-y-2">POS</span>
          </div>

          <div className="relative">
            <div className="absolute -inset-1 rounded-3xl bg-brandYellow/40 opacity-40 blur-sm" />
            <div className="relative bg-white rounded-3xl shadow-2xl px-6 py-7 sm:px-8 sm:py-8">
              <div className="flex items-center justify-center gap-3 sm:gap-4">
                <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900">Welcome</h1>
                <span className="text-xl sm:text-2xl">👋</span>
                <span className="h-1.5 w-12 sm:w-16 rounded-full bg-slate-900" />
              </div>
              <p className="mt-3 text-slate-500 text-center text-sm sm:text-base">
                Enter your credentials to access your account
              </p>

              <div className="mt-6">
                <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
                  <label className="grid gap-2 text-xs sm:text-sm text-slate-600">
                    Email address
                    <input
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brandYellow"
                      placeholder="you@example.com"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label className="grid gap-2 text-xs sm:text-sm text-slate-600">
                    Password
                    <input
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brandYellow"
                      placeholder="Enter your password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    className="mt-2 w-full rounded-2xl bg-brandYellow text-slate-900 font-semibold py-3 hover:bg-brandYellowDark transition transform hover:-translate-y-1 hover:shadow-lg"
                  >
                    Sign in
                  </button>
                  {status && <div className="text-xs sm:text-sm text-slate-500">{status}</div>}
                </form>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Login;
