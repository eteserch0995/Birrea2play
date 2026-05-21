// Visualización de un enfrentamiento knockout: home vs away con resultado.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';
import TeamBadge from './TeamBadge';

export default function MatchupCard({ match, teams }) {
  if (!match) return null;
  const home = teams.find((t) => t.id === match.team_home_id);
  const away = teams.find((t) => t.id === match.team_away_id);
  const isFinished = match.status === 'finished';
  const isTie = isFinished && (match.goles_home ?? 0) === (match.goles_away ?? 0);
  const phaseLabel = ({
    octavos: 'OCTAVOS', cuartos: 'CUARTOS', semis: 'SEMIFINAL',
    tercer_lugar: 'TERCER LUGAR', final: 'FINAL',
  })[match.fase] ?? (match.fase ?? '').toUpperCase();

  return (
    <View style={styles.card}>
      <Text style={styles.phaseLabel}>{phaseLabel}</Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <TeamBadge team={home} size={32} />
        </View>
        <View style={styles.score}>
          {isFinished ? (
            <>
              <Text style={styles.scoreText}>{match.goles_home}–{match.goles_away}</Text>
              {isTie && match.fue_a_penales && (
                <Text style={styles.penText}>pen {match.goles_pen_home}–{match.goles_pen_away}</Text>
              )}
            </>
          ) : (
            <Text style={styles.vsText}>VS</Text>
          )}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <TeamBadge team={away} size={32} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy },
  phaseLabel:  { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gold, letterSpacing: 1.5, marginBottom: 6, textTransform: 'uppercase' },
  row:         { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  score:       { alignItems: 'center', minWidth: 60 },
  scoreText:   { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 1 },
  vsText:      { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray, letterSpacing: 1 },
  penText:     { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gold, marginTop: 2 },
});
