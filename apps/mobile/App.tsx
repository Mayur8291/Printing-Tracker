import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { APPLICATION_NAME } from '@canto/shared';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{APPLICATION_NAME}</Text>
      <Text style={styles.subtitle}>Your workspace, wherever you work.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f8fa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 40, fontWeight: '700', color: '#142239' },
  subtitle: { fontSize: 16, color: '#526174', marginTop: 12 },
});
