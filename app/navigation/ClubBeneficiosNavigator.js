import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import ClubHomeScreen      from '../screens/club/ClubHomeScreen';
import ClubEmpresaScreen   from '../screens/club/ClubEmpresaScreen';
import ClubBeneficioScreen from '../screens/club/ClubBeneficioScreen';
import ClubCuponScreen     from '../screens/club/ClubCuponScreen';
import ClubCarneScreen     from '../screens/club/ClubCarneScreen';
import ClubScannerScreen   from '../screens/club/ClubScannerScreen';
import ClubHistorialScreen from '../screens/club/ClubHistorialScreen';
import ClubGaleriaScreen   from '../screens/club/ClubGaleriaScreen';

const Stack = createStackNavigator();

// Stack interno del modulo Club de Beneficios.
// Socio: Home -> Empresa -> Beneficio -> Cupon ; Carne.
// Comercio (staff): Scanner / Historial / Galeria.
export default function ClubBeneficiosNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ClubHome"      component={ClubHomeScreen} />
      <Stack.Screen name="ClubEmpresa"   component={ClubEmpresaScreen} />
      <Stack.Screen name="ClubBeneficio" component={ClubBeneficioScreen} />
      <Stack.Screen name="ClubCupon"     component={ClubCuponScreen} />
      <Stack.Screen name="ClubCarne"     component={ClubCarneScreen} />
      <Stack.Screen name="ClubScanner"   component={ClubScannerScreen} />
      <Stack.Screen name="ClubHistorial" component={ClubHistorialScreen} />
      <Stack.Screen name="ClubGaleria"   component={ClubGaleriaScreen} />
    </Stack.Navigator>
  );
}
