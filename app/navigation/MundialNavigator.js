import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import MundialHomeScreen from '../screens/mundial/MundialHomeScreen';

const Stack = createStackNavigator();

// Stack interno del módulo Mundial 2026.
// Por ahora solo expone MundialHome (placeholder).
// En tareas siguientes se agregan: Inscripción, Survivor pick, Polla prediction,
// Ranking, Bonus picks, Reglas.
export default function MundialNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MundialHome" component={MundialHomeScreen} />
    </Stack.Navigator>
  );
}
