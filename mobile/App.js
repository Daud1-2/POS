import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { account, ID } from './src/lib/appwrite';

export default function App() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');

  const handleAuth = async () => {
    setStatus('Working...');
    try {
      if (mode === 'register') {
        await account.create({
          userId: ID.unique(),
          email,
          password,
          name: name || email,
        });
      }
      await account.createEmailPasswordSession({ email, password });
      setStatus('Signed in');
    } catch (err) {
      setStatus(err?.message || 'Authentication failed');
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-slate-900">
      <View className="w-full max-w-xs px-6">
        <Text className="text-white text-2xl font-semibold">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Text>
        <Text className="text-slate-300 mt-2">
          Mobile cashier login.
        </Text>
        {mode === 'register' && (
          <TextInput
            className="mt-6 bg-slate-800 text-white px-3 py-2 rounded-md"
            placeholder="Name"
            placeholderTextColor="#94a3b8"
            value={name}
            onChangeText={setName}
          />
        )}
        <TextInput
          className="mt-4 bg-slate-800 text-white px-3 py-2 rounded-md"
          placeholder="Email"
          placeholderTextColor="#94a3b8"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          className="mt-4 bg-slate-800 text-white px-3 py-2 rounded-md"
          placeholder="Password"
          placeholderTextColor="#94a3b8"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity
          onPress={handleAuth}
          className="mt-6 bg-cyan-500 rounded-md py-3 items-center"
        >
          <Text className="text-slate-900 font-semibold">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setStatus('');
          }}
          className="mt-3"
        >
          <Text className="text-slate-300 text-sm">
            {mode === 'login'
              ? 'Need an account? Create one'
              : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>
        {status ? <Text className="text-slate-300 mt-4">{status}</Text> : null}
      </View>
      <StatusBar style="light" />
    </View>
  );
}
