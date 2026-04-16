import React from 'react';
import { ScrollView, Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';

export default function PrivacyPolicyScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>POLÍTICA DE PRIVACIDAD</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Última actualización: 15 de abril de 2026</Text>

        <Section title="1. Información General">
          {`Birrea2Play ("la App", "nosotros") es una aplicación móvil operada por Birrea2Play, con sede en la República de Panamá. Esta Política de Privacidad describe cómo recopilamos, usamos, almacenamos y protegemos la información personal de nuestros usuarios ("usted", "el usuario") al utilizar la App.

Al registrarse o utilizar Birrea2Play, usted acepta las prácticas descritas en esta política. Si no está de acuerdo, no use la App.`}
        </Section>

        <Section title="2. Información que Recopilamos">
          {`a) Información que usted nos proporciona directamente:
• Nombre completo
• Correo electrónico
• Número de teléfono (para pagos Yappy)
• Foto de perfil (opcional)
• Género (para categorización de eventos deportivos)
• Posición y nivel deportivo (opcional)

b) Información recopilada automáticamente:
• Identificador de dispositivo
• Sistema operativo y versión de la App
• Fecha y hora de acceso
• Registros de transacciones dentro de la App (inscripciones, compras, recargas de wallet)

c) Información de terceros:
• Datos de autenticación de Supabase Auth
• Información de transacciones procesadas mediante Yappy PA (Banco General)`}
        </Section>

        <Section title="3. Cómo Usamos su Información">
          {`Usamos la información recopilada para:
• Crear y gestionar su cuenta de usuario
• Procesar inscripciones a eventos deportivos
• Procesar pagos y recargas de wallet mediante Yappy
• Enviar notificaciones push sobre eventos, resultados y MVPs
• Generar estadísticas deportivas de su perfil
• Mejorar la experiencia de usuario y funcionalidades de la App
• Cumplir con obligaciones legales y prevenir fraudes
• Comunicarnos con usted sobre actualizaciones importantes`}
        </Section>

        <Section title="4. Base Legal para el Tratamiento">
          {`El tratamiento de sus datos personales se basa en:
• Ejecución del contrato: necesario para proveer los servicios de la App
• Consentimiento: para notificaciones push y comunicaciones de marketing
• Interés legítimo: para seguridad, prevención de fraude y mejora del servicio
• Cumplimiento legal: cuando la ley panameña lo requiera

Esta App cumple con la Ley 81 de 2019 de Protección de Datos Personales de la República de Panamá.`}
        </Section>

        <Section title="5. Compartición de Información">
          {`No vendemos ni alquilamos su información personal a terceros. Podemos compartir datos con:

• Supabase Inc.: proveedor de base de datos y autenticación (política: supabase.com/privacy)
• Banco General / Yappy PA: para procesamiento de pagos
• Autoridades gubernamentales: únicamente cuando sea requerido por ley

Todos los proveedores están sujetos a acuerdos de procesamiento de datos y están obligados a proteger su información.`}
        </Section>

        <Section title="6. Pagos y Datos Financieros">
          {`Los pagos dentro de la App se procesan mediante Yappy PA (Banco General de Panamá). Birrea2Play NO almacena números de tarjetas de crédito, datos bancarios ni información financiera sensible.

Las transacciones Yappy se procesan directamente entre su cuenta Yappy y nuestra cuenta de merchant. Solo almacenamos el ID de referencia de la transacción y el monto para efectos de historial.`}
        </Section>

        <Section title="7. Seguridad de los Datos">
          {`Implementamos medidas técnicas y organizativas para proteger su información:
• Cifrado en tránsito mediante TLS/HTTPS
• Base de datos con Row Level Security (RLS) — cada usuario solo accede a sus propios datos
• Autenticación segura mediante Supabase Auth con tokens JWT
• Acceso restringido a datos sensibles solo para administradores autorizados
• Revisiones periódicas de seguridad

A pesar de estas medidas, ningún sistema es 100% seguro. En caso de violación de seguridad que afecte sus datos, le notificaremos dentro de los plazos que establezca la ley aplicable.`}
        </Section>

        <Section title="8. Retención de Datos">
          {`Conservamos su información personal mientras su cuenta esté activa o sea necesaria para proveer los servicios. Si elimina su cuenta:
• Los datos de perfil se eliminan dentro de 30 días
• Los registros de transacciones se conservan por 5 años por obligaciones fiscales y legales
• Las estadísticas deportivas anonimizadas pueden conservarse indefinidamente`}
        </Section>

        <Section title="9. Sus Derechos">
          {`Como usuario, usted tiene derecho a:
• Acceso: solicitar una copia de sus datos personales
• Rectificación: corregir datos inexactos desde la App (Perfil → Editar)
• Eliminación: solicitar la eliminación de su cuenta y datos
• Portabilidad: recibir sus datos en formato estructurado
• Oposición: oponerse a ciertos tipos de tratamiento
• Revocación del consentimiento: retirar su consentimiento en cualquier momento

Para ejercer estos derechos, contáctenos en: privacidad@birrea2play.com`}
        </Section>

        <Section title="10. Notificaciones Push">
          {`La App puede enviar notificaciones push sobre:
• Nuevos eventos disponibles
• Resultados de partidos
• Declaración de MVP
• Movimientos en su wallet

Puede desactivar las notificaciones desde Ajustes de su dispositivo en cualquier momento. Esto no afectará el uso general de la App.`}
        </Section>

        <Section title="11. Menores de Edad">
          {`Birrea2Play no está dirigida a menores de 13 años. No recopilamos intencionalmente datos de menores de 13 años. Si usted es padre o tutor y cree que su hijo nos ha proporcionado datos personales, contáctenos para eliminarlos.`}
        </Section>

        <Section title="12. Cambios a esta Política">
          {`Podemos actualizar esta Política de Privacidad ocasionalmente. Le notificaremos sobre cambios significativos mediante notificación en la App o por correo electrónico. El uso continuado de la App después de los cambios implica su aceptación.`}
        </Section>

        <Section title="13. Contacto">
          {`Si tiene preguntas, inquietudes o desea ejercer sus derechos, contáctenos:

Birrea2Play
Correo: privacidad@birrea2play.com
República de Panamá

Para quejas ante la autoridad competente puede contactar al Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales (ANTAI) de Panamá.`}
        </Section>

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.bg },
  header:       { padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.navy },
  backBtn:      { marginBottom: SPACING.xs },
  backText:     { fontFamily: FONTS.bodyMedium, color: COLORS.blue2, fontSize: 14 },
  title:        { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 3 },
  content:      { padding: SPACING.md, gap: SPACING.md },
  updated:      { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, fontStyle: 'italic' },
  section:      { gap: SPACING.xs },
  sectionTitle: { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.gold, marginBottom: 4 },
  body:         { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 20 },
});
