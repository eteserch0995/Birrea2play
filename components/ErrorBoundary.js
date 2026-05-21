// ErrorBoundary global: atrapa cualquier excepción no capturada en el render
// tree y muestra un fallback en español, en lugar de dejar la pantalla blanca.
// Loguea con `logger` para que aparezca en consola con prefijo [B2P].

import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { logError } from '../lib/logger';

const COLORS = {
  bg: '#07101F',
  card: '#0E1A2E',
  red: '#C8102E',
  white: '#FFFFFF',
  gray: '#9AA8BA',
};

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    logError({
      screen: 'ErrorBoundary',
      action: 'render',
      technical: error,
      extra: { componentStack: info?.componentStack?.slice(0, 500) },
    });
  }

  handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    } else {
      // En nativo no podemos reload directo; reseteamos el boundary.
      this.setState({ hasError: false, error: null });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Text style={{ color: COLORS.white, fontSize: 36 }}>!</Text>
          </View>
          <Text style={{ color: COLORS.white, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
            Algo salió mal
          </Text>
          <Text style={{ color: COLORS.gray, fontSize: 14, textAlign: 'center', marginBottom: 24, maxWidth: 320 }}>
            La pantalla no se pudo cargar. Intenta recargar la app. Si el problema continúa, contáctanos.
          </Text>
          <TouchableOpacity
            onPress={this.handleReload}
            style={{ backgroundColor: COLORS.red, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
          >
            <Text style={{ color: COLORS.white, fontWeight: '700', letterSpacing: 1 }}>
              {Platform.OS === 'web' ? 'Recargar' : 'Reintentar'}
            </Text>
          </TouchableOpacity>
          {__DEV__ && this.state.error?.message ? (
            <Text style={{ color: COLORS.gray, fontSize: 11, marginTop: 24, textAlign: 'center', maxWidth: 360 }}>
              {String(this.state.error.message).slice(0, 200)}
            </Text>
          ) : null}
        </View>
      );
    }
    return this.props.children;
  }
}
