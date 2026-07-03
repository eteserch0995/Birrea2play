import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

const mundialLogo = require('../assets/mundial/mundial-logo.png');

/**
 * Flyer del Mundial que aparece al entrar a la app (1 vez por día durante la
 * ventana flyer_until). "Ver más" lleva al módulo Mundial.
 */
export default function WCFlyerModal({ visible, onVerMas, onDismiss, survivorPozo, pollaPozo }) {
  const hasPozos = survivorPozo != null || pollaPozo != null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Image source={mundialLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.kicker}>BIRREA2PLAY</Text>
          <Text style={styles.title}>MUNDIAL 2026</Text>
          <Text style={styles.body}>
            Inscribite al Survivor o la Polla y jugá por la bolsa acumulada.{'\n'}
            Invitá amigos con tu código y ganá $3 por cada uno.
          </Text>

          {hasPozos && (
            <View style={styles.pozos}>
              {survivorPozo != null && (
                <View style={styles.pozoCol}>
                  <Text style={styles.pozoLabel}>SURVIVOR</Text>
                  <Text style={styles.pozoVal}>${Number(survivorPozo).toFixed(0)}</Text>
                </View>
              )}
              {pollaPozo != null && (
                <View style={styles.pozoCol}>
                  <Text style={styles.pozoLabel}>POLLA</Text>
                  <Text style={styles.pozoVal}>${Number(pollaPozo).toFixed(0)}</Text>
                </View>
              )}
            </View>
          )}

          <TouchableOpacity style={styles.btnMain} onPress={onVerMas} activeOpacity={0.85}>
            <Text style={styles.btnMainText}>VER MÁS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSkip} onPress={onDismiss}>
            <Text style={styles.btnSkipText}>Ahora no</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000B3',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  card: {
    backgroundColor: 'rgba(10,14,20,0.97)',
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.gold + '88',
  },
  logo: {
    width: 96, height: 96, borderRadius: RADIUS.lg,
    borderWidth: 2, borderColor: COLORS.white, backgroundColor: COLORS.white,
    marginBottom: SPACING.xs,
  },
  kicker: {
    fontFamily: FONTS.bodyBold, fontSize: 11,
    color: COLORS.magentaText || COLORS.magenta, letterSpacing: 3,
  },
  title: {
    fontFamily: FONTS.heading, fontSize: 34, color: COLORS.white, letterSpacing: 2,
  },
  body: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    textAlign: 'center', lineHeight: 20, marginTop: 4,
  },
  pozos: {
    flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm, marginBottom: 4,
  },
  pozoCol: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minWidth: 110,
  },
  pozoLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gray2,
    letterSpacing: 1.5,
  },
  pozoVal: {
    fontFamily: FONTS.heading, fontSize: 28, color: COLORS.neon, letterSpacing: 1, marginTop: 2,
  },
  btnMain: {
    width: '100%',
    backgroundColor: COLORS.magentaA11y || COLORS.magenta,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  btnMainText: {
    fontFamily: FONTS.heading, color: COLORS.white, fontSize: 16, letterSpacing: 2,
  },
  btnSkip: { padding: SPACING.sm },
  btnSkipText: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 14 },
});
