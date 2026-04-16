import React from 'react';
import { ScrollView, Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING } from '../../../constants/theme';

export default function TermsScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>TÉRMINOS Y CONDICIONES</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Última actualización: 15 de abril de 2026</Text>

        <Section title="1. Aceptación de los Términos">
          {`Al descargar, instalar o usar la aplicación Birrea2Play ("la App"), usted acepta quedar vinculado por estos Términos y Condiciones de Uso ("Términos"). Si no está de acuerdo con alguno de estos términos, no utilice la App.

Birrea2Play se reserva el derecho de modificar estos Términos en cualquier momento. El uso continuado de la App después de cualquier cambio constituye su aceptación de los nuevos términos.`}
        </Section>

        <Section title="2. Descripción del Servicio">
          {`Birrea2Play es una plataforma digital de gestión de torneos y ligas deportivas amateur en Panamá que permite:
• Registrarse e inscribirse a eventos deportivos (fútbol, baloncesto, vóleibol, entre otros)
• Gestionar equipos, partidos y resultados
• Votar por el Jugador Más Valioso (MVP) de cada evento
• Realizar pagos de inscripciones y compras mediante wallet interno y Yappy PA
• Comprar artículos en la tienda de la plataforma
• Recibir noticias y actualizaciones sobre eventos deportivos

El servicio está disponible para usuarios en la República de Panamá.`}
        </Section>

        <Section title="3. Registro y Cuenta de Usuario">
          {`Para usar la App, debe:
• Ser mayor de 13 años (mayores de 18 para realizar transacciones económicas)
• Proporcionar información veraz, precisa y completa
• Mantener la confidencialidad de su contraseña
• Notificarnos inmediatamente si sospecha de uso no autorizado de su cuenta

Usted es responsable de todas las actividades que ocurran bajo su cuenta. Birrea2Play se reserva el derecho de suspender o eliminar cuentas que violen estos Términos.`}
        </Section>

        <Section title="4. Wallet y Pagos">
          {`4.1 Wallet Virtual
La App incluye un monedero virtual ("wallet") con saldo expresado en dólares americanos (USD). Este saldo:
• Solo puede usarse dentro de la plataforma Birrea2Play
• No es reembolsable en efectivo (salvo por errores comprobables de la plataforma)
• No genera intereses
• No tiene vencimiento mientras la cuenta esté activa

4.2 Recargas mediante Yappy PA
Las recargas de wallet se procesan mediante Yappy (Banco General de Panamá). Al realizar una recarga, usted:
• Autoriza el débito de su cuenta Yappy por el monto indicado
• Acepta los términos y condiciones de Yappy PA / Banco General
• Comprende que Birrea2Play acreditará el saldo únicamente tras confirmar el pago

4.3 Premio MVP
Al ganar la votación de MVP de un evento, se acredita $1.00 a su wallet automáticamente. Este premio está sujeto a disponibilidad y puede modificarse con previo aviso.

4.4 Inscripciones
El valor de las inscripciones se descuenta del wallet en el momento de confirmación. Las inscripciones son definitivas salvo que el organizador cancele el evento, en cuyo caso se realizará un reembolso automático al wallet.`}
        </Section>

        <Section title="5. Tienda In-App">
          {`Las compras realizadas en la tienda de Birrea2Play están sujetas a:
• Disponibilidad de stock al momento de la compra
• El monto se descuenta del wallet al confirmar el pedido
• La entrega de productos físicos es responsabilidad del organizador del evento o administrador
• No se aceptan devoluciones de productos digitales
• Los productos físicos pueden devolverse dentro de 7 días si están en condición original`}
        </Section>

        <Section title="6. Eventos Deportivos">
          {`6.1 Organizadores
Los gestores y administradores de eventos son responsables de:
• La veracidad de la información del evento
• La organización y ejecución del evento
• El cumplimiento de las normas deportivas aplicables

6.2 Participantes
Al inscribirse a un evento, usted:
• Confirma que cumple los requisitos del evento (género, nivel, etc.)
• Acepta participar bajo las reglas del evento
• Exonera a Birrea2Play de responsabilidad por lesiones durante la actividad deportiva
• Acepta que Birrea2Play pueda usar imágenes/videos del evento con fines promocionales`}
        </Section>

        <Section title="7. Conducta del Usuario">
          {`Está prohibido:
• Usar la App para fines ilegales o no autorizados
• Proporcionar información falsa al registrarse o participar en eventos
• Acosar, amenazar o discriminar a otros usuarios
• Intentar acceder a cuentas de otros usuarios
• Interferir con el funcionamiento de la App o sus servidores
• Crear múltiples cuentas para evadir sanciones
• Usar la App para distribución de spam o contenido malicioso

El incumplimiento puede resultar en suspensión o eliminación permanente de la cuenta, sin reembolso del saldo de wallet.`}
        </Section>

        <Section title="8. Votación MVP">
          {`El sistema de votación MVP está diseñado para reconocer al mejor jugador de cada evento. Las reglas son:
• Cada usuario registrado en el evento puede emitir UN (1) voto por evento
• No puede votar por sí mismo
• La votación cierra según lo determine el organizador del evento
• En caso de empate, el ganador se selecciona aleatoriamente entre los empatados
• Las decisiones del sistema son finales y no están sujetas a apelación
• Intentar manipular la votación resultará en suspensión de la cuenta`}
        </Section>

        <Section title="9. Propiedad Intelectual">
          {`Todo el contenido de la App, incluyendo pero no limitado a diseños, logos, textos, imágenes, código y funcionalidades, es propiedad de Birrea2Play o sus licenciantes y está protegido por las leyes de propiedad intelectual de la República de Panamá y tratados internacionales.

Se concede al usuario una licencia limitada, no exclusiva, no transferible para usar la App según estos Términos. No se permite la reproducción, distribución o modificación sin autorización expresa.`}
        </Section>

        <Section title="10. Limitación de Responsabilidad">
          {`Birrea2Play no será responsable por:
• Daños indirectos, incidentales, especiales o consecuentes
• Pérdida de datos o interrupción del servicio por causas fuera de nuestro control
• Lesiones o daños ocurridos durante actividades deportivas
• Conducta de otros usuarios dentro o fuera de la plataforma
• Fallas en el servicio de Yappy PA o conexión a internet del usuario
• Cambios en la disponibilidad o contenido de eventos por decisión de organizadores

La responsabilidad máxima de Birrea2Play ante cualquier reclamación no excederá el monto pagado por el usuario en los 90 días anteriores al incidente.`}
        </Section>

        <Section title="11. Privacidad">
          {`El tratamiento de sus datos personales se rige por nuestra Política de Privacidad, disponible en la App. Al aceptar estos Términos, también acepta dicha política.`}
        </Section>

        <Section title="12. Modificaciones del Servicio">
          {`Birrea2Play se reserva el derecho de:
• Modificar, suspender o descontinuar cualquier función de la App
• Actualizar los precios de inscripciones y servicios con previo aviso de 15 días
• Agregar o eliminar tipos de eventos disponibles

Notificaremos cambios significativos mediante la App o por correo electrónico.`}
        </Section>

        <Section title="13. Terminación">
          {`Estos Términos permanecen vigentes mientras use la App. Usted puede terminar su relación con Birrea2Play eliminando su cuenta desde Perfil → Configuración.

Birrea2Play puede suspender o eliminar su cuenta si viola estos Términos, con o sin previo aviso según la gravedad de la infracción.`}
        </Section>

        <Section title="14. Ley Aplicable y Jurisdicción">
          {`Estos Términos se rigen por las leyes de la República de Panamá. Cualquier disputa será sometida a la jurisdicción de los tribunales competentes de la Ciudad de Panamá, renunciando a cualquier otro fuero que pudiera corresponder.

Las partes intentarán resolver cualquier controversia de buena fe antes de recurrir a instancias judiciales.`}
        </Section>

        <Section title="15. Contacto">
          {`Para preguntas sobre estos Términos y Condiciones:

Birrea2Play
Correo: legal@birrea2play.com
República de Panamá`}
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
  backBtn:      { marginBottom: 4 },
  backText:     { fontFamily: FONTS.bodyMedium, color: COLORS.blue2, fontSize: 14 },
  title:        { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 3 },
  content:      { padding: SPACING.md, gap: SPACING.md },
  updated:      { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, fontStyle: 'italic' },
  section:      { gap: 4 },
  sectionTitle: { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.gold, marginBottom: 4 },
  body:         { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 20 },
});
