import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

export default function App() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900">
      <Text className="text-white text-lg font-semibold">POS Mobile (Expo)</Text>
      <Text className="text-slate-300 mt-2">NativeWind is ready.</Text>
      <StatusBar style="light" />
    </View>
  );
}
