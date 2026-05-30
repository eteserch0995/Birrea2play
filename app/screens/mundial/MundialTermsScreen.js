import React from 'react';
import { View, Text, ScrollView, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';
import { WCBlock, WCBadge, WCHeader, WCButton } from '../../../components/mundial/WCComponents';

// Versión de los T&C del Módulo Mundial. La usa la pantalla de inscripción
// para dejar constancia de qué versión aceptó el participante (Sección 21).
export const MUNDIAL_TYC_VERSION = '2026-05-30';

const TERMS_WEB_URL = 'https://birrea2play.com/terminos-mundial.html';

// Subcomponentes locales para no alterar el wording legal (solo formato).
function P({ children, light }) {
  return <Text style={[styles.text, light && styles.textLight]}>{children}</Text>;
}

// `light` invierte el color del bold para mantener contraste sobre cards claras
// (sección 21 usa variant="light"): bold blanco sería ilegible.
function B({ children, light }) {
  return <Text style={[styles.bold, light && styles.boldLight]}>{children}</Text>;
}

export default function MundialTermsScreen({ navigation, route }) {
  // mode opcional (p.ej. 'inscripcion'); no es obligatorio usarlo.
  const mode = route?.params?.mode;

  return (
    <MundialScreenFrame>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <WCHeader
            kicker="Mundial 2026"
            title="TÉRMINOS Y CONDICIONES"
            onBack={() => navigation.goBack()}
          />

          {/* Encabezado / metadatos */}
          <WCBlock title="📄 Términos y Condiciones del Módulo Mundial" accent="gold">
            <View style={styles.versionRow}>
              <WCBadge label="Versión 1.1 — vigencia junio 2026" tone="gold" />
            </View>
            <Text style={styles.text}>
              <B>Organizador:</B> Birrea2Play (proyecto personal de Sergio Bosso, persona natural,
              República de Panamá).{'\n'}
              <B>Contacto:</B> sergio.bosso09@gmail.com{'\n'}
              <B>Sitio:</B> birrea2play.com
            </Text>
            <Text style={styles.subText}>
              Nota inicial: Este documento es un Anexo que complementa, y no reemplaza, los Términos y
              Condiciones Generales y la Política de Privacidad de Birrea2Play. En todo lo no previsto
              aquí, aplican dichos documentos. En caso de contradicción puntual sobre el Módulo Mundial,
              prevalece este Anexo respecto de esa materia específica. Le recomendamos leerlo completo
              antes de inscribirse.
            </Text>
            <WCButton
              label="VER VERSIÓN WEB"
              variant="gold"
              size="md"
              leadingIcon="🌐"
              onPress={() => Linking.openURL(TERMS_WEB_URL)}
              style={{ marginTop: SPACING.md }}
            />
          </WCBlock>

          {/* 1 */}
          <WCBlock title="1. Definiciones" accent="blue">
            <P>Para efectos de este Anexo:</P>
            <P>
              {'\n'}• <B>Módulo Mundial</B> o <B>Módulo:</B> la sub-aplicación temporal de Birrea2Play
              habilitada con ocasión del torneo internacional de fútbol que se disputará entre el{' '}
              <B>11 de junio de 2026 y el 19 de julio de 2026</B>.{'\n'}
              • <B>Organizador:</B> Birrea2Play, proyecto personal operado por Sergio Bosso, persona
              natural domiciliada en la República de Panamá.{'\n'}
              • <B>Participante</B> o <B>Usuario:</B> la persona natural mayor de edad que se inscribe
              en cualquiera de los concursos del Módulo.{'\n'}
              • <B>Concursos:</B> los juegos de predicción denominados "Survivor 3 Vidas" y "Polla
              Ganadora".{'\n'}
              • <B>Créditos internos:</B> unidades de registro contable interno de la plataforma,
              expresadas como referencia en dólares de los Estados Unidos de América (US$),{' '}
              <B>no retirables y no transferibles</B>, según se define en los Términos Generales.{'\n'}
              • <B>Pozo:</B> el fondo común conformado con las inscripciones, según se describe en la
              Sección 5.{'\n'}
              • <B>Congelamiento:</B> el momento a partir del cual se cierran las inscripciones y la
              edición de predicciones.
            </P>
          </WCBlock>

          {/* 2 */}
          <WCBlock title="2. Naturaleza de la actividad y caracterización legal" accent="magenta">
            <P>
              2.1. El Organizador ofrece los Concursos como una <B>actividad recreativa de predicción</B>{' '}
              entre miembros de una comunidad privada, con fines de entretenimiento. Esta caracterización
              es meramente descriptiva y <B>no constituye una determinación legal</B> sobre la naturaleza
              de la actividad ni una garantía de que quede fuera del ámbito de la regulación aplicable.
            </P>
            <P>
              {'\n'}2.2. Birrea2Play <B>no cuenta con licencia de operador de juegos de suerte y azar</B>{' '}
              y no opera estos Concursos como tal. El Organizador <B>no garantiza la calificación
              regulatoria</B> de la actividad, la cual corresponde determinar a la autoridad competente
              conforme a la legislación panameña aplicable.
            </P>
            <P>
              {'\n'}2.3. El Organizador <B>no es</B> una institución financiera, entidad de pago, emisor
              de dinero electrónico ni operador licenciado de juegos. Los <B>créditos internos</B> están
              diseñados para funcionar únicamente como una <B>referencia contable interna</B> y{' '}
              <B>no pretenden ser dinero electrónico</B> ni un instrumento financiero regulado.
            </P>
            <P>
              {'\n'}2.4. El Organizador <B>retiene una comisión de operación</B>. Según la Sección 5, del
              total recaudado el <B>91.5%</B> se destina al Pozo y el Organizador retiene el <B>8.5%</B>{' '}
              restante, que cubre la comisión de la plataforma de pago (Yappy) y una comisión de operación
              de aproximadamente <B>3.5%</B>.
            </P>
            <P>
              {'\n'}2.5. La participación es <B>voluntaria</B>. Ninguna disposición de este Anexo debe
              interpretarse como una afirmación de que la actividad escapa, total o parcialmente, a la
              supervisión de cualquier autoridad con competencia sobre la materia.
            </P>
          </WCBlock>

          {/* 3 */}
          <WCBlock title="3. Elegibilidad" accent="neon">
            <P>
              3.1. La inscripción y participación en el Módulo está <B>estrictamente reservada a personas
              mayores de 18 años</B> con plena capacidad legal para contratar.
            </P>
            <P>
              {'\n'}3.2. Al inscribirse, el Participante declara y garantiza que es mayor de edad, que la
              información que proporciona es veraz y que actúa por cuenta propia.
            </P>
            <P>
              {'\n'}3.3. El Organizador podrá solicitar, en cualquier momento, documentación que acredite
              la edad y la identidad del Participante (ver Sección 11). La negativa a proporcionarla podrá
              resultar en la suspensión de la participación o en la retención del premio.
            </P>
          </WCBlock>

          {/* 4 */}
          <WCBlock title="4. Descripción de los Concursos" accent="blue">
            <P><B>4.1. Survivor 3 Vidas</B></P>
            <P>
              {'\n'}• <B>Inscripción:</B> US$10.{'\n'}
              • <B>Mecánica:</B> cada Participante cuenta con <B>3 vidas</B>. En cada jornada-día deberá
              seleccionar <B>un (1) equipo</B>. Durante la fase de grupos, <B>cada equipo solo puede ser
              elegido una vez</B> por el mismo Participante.{'\n'}
              • <B>Penalización:</B> si el equipo seleccionado <B>empata o pierde</B>, el Participante
              pierde una vida.{'\n'}
              • <B>Objetivo:</B> sobrevivir la fase de grupos conservando al menos una vida.
            </P>
            <P>{'\n'}<B>4.2. Polla Ganadora</B></P>
            <P>
              {'\n'}• <B>Inscripción:</B> US$15.{'\n'}
              • <B>Mecánica:</B> el Participante predice los <B>marcadores de 104 partidos</B>, más{' '}
              <B>5 pronósticos bonus</B> (campeón, subcampeón, tercer lugar, goleador, jugador más
              valioso y marcador final, según se habilite en la interfaz).{'\n'}
              • <B>Puntuación:</B> se asignan <B>3, 5 u 8 puntos</B> según el tipo de acierto,{' '}
              <B>multiplicados por un factor correspondiente a la fase</B> del torneo, conforme a las
              reglas y tablas publicadas dentro del Módulo.
            </P>
            <P>
              {'\n'}4.3. Las reglas operativas detalladas, fechas de jornadas, tablas de puntuación y
              multiplicadores se publican dentro del Módulo y forman parte integral de este Anexo. Ante
              cualquier duda interpretativa sobre la mecánica, el Participante puede consultar al
              Organizador por el canal de la Sección 17.
            </P>
          </WCBlock>

          {/* 5 */}
          <WCBlock title="5. Pozo, recaudación y comisión" accent="gold">
            <P>
              5.1. El <B>Pozo</B> se conforma con aproximadamente el <B>91.5% de lo recaudado</B> por
              concepto de inscripciones de cada Concurso.
            </P>
            <P>
              {'\n'}5.2. El <B>8.5% restante</B> cubre la <B>comisión de la plataforma de pago (Yappy,
              ~5%)</B> y la <B>comisión de operación del Organizador (aproximadamente 3.5%)</B>.
            </P>
            <P>
              {'\n'}5.3. El Organizador <B>retiene una comisión de operación de aproximadamente 3.5%</B>{' '}
              del total recaudado (incluida en el 8.5% de la Sección 5.2).
            </P>
            <P>
              {'\n'}5.4. Los importes correspondientes al Pozo se mantienen identificados y separados de
              cualquier uso personal por parte del Organizador hasta el pago del premio (ver Sección 16,
              custodia de fondos).
            </P>
          </WCBlock>

          {/* 6 */}
          <WCBlock title="6. Inscripción, medios de pago y congelamiento" accent="magenta">
            <P><B>6.1. Medios de pago de la inscripción:</B></P>
            <P>
              {'\n'}• <B>Wallet</B> (créditos internos, no retirables ni transferibles);{'\n'}
              • <B>Yappy</B> (Banco General, S.A.); o{'\n'}
              • <B>Efectivo</B>, únicamente cuando sea <B>aprobado por el administrador</B>.
            </P>
            <P>
              {'\n'}6.2. El cobro de la inscripción <B>ocurre fuera de los sistemas de pago de las
              tiendas de aplicaciones</B> (se procesa por la vía web), conforme a la Sección 13.
            </P>
            <P>
              {'\n'}6.3. <B>Congelamiento:</B> las inscripciones y la edición de predicciones se{' '}
              <B>cierran el 11 de junio de 2026 a las ~11:00 a.m. hora de Panamá (16:00 UTC)</B>. A partir
              de ese momento <B>no se admiten</B> nuevas inscripciones, modificaciones de pronósticos ni
              cambios de selección, salvo error material atribuible al Organizador.
            </P>
            <P>
              {'\n'}6.4. La inscripción se considera <B>perfeccionada</B> únicamente cuando el pago ha sido
              confirmado por el medio correspondiente antes del Congelamiento.
            </P>
          </WCBlock>

          {/* 7 */}
          <WCBlock title="7. Resultados, fuente de datos y correcciones" accent="neon">
            <P>
              7.1. Los resultados de los partidos se obtienen del proveedor de datos <B>api-football</B>.
            </P>
            <P>
              {'\n'}7.2. El Organizador se reserva el derecho de aplicar un <B>ajuste o corrección manual
              ("override")</B> cuando detecte un error evidente en los datos del proveedor, un cambio
              oficial de resultado por la autoridad deportiva, o una inconsistencia material. Toda
              corrección busca reflejar el <B>resultado oficial real</B> del partido.
            </P>
            <P>
              {'\n'}7.3. En caso de discrepancia entre el dato del proveedor y el resultado oficial
              reconocido por el organismo rector del torneo, prevalecerá el <B>resultado oficial</B>.
            </P>
          </WCBlock>

          {/* 8 */}
          <WCBlock title="8. Premios, ganadores y desempate" accent="gold">
            <P>
              8.1. <B>Polla Ganadora:</B> el premio se reparte entre los <B>tres (3) primeros del
              ranking</B> por puntaje acumulado: <B>60% para el 1.º, 25% para el 2.º y 15% para el 3.º</B>.
              Si hubiera solo dos participantes pagados, <B>70%/30%</B>; si hubiera uno, <B>100%</B>. Los
              empates se resuelven mediante un <B>criterio de desempate determinista</B> publicado dentro
              del Módulo (basado en reglas objetivas y predefinidas, no aleatorias).
            </P>
            <P>
              {'\n'}8.2. <B>Survivor 3 Vidas:</B> el premio corresponde al <B>sobreviviente o
              sobrevivientes</B>. De existir más de un sobreviviente, el Pozo se <B>reparte</B> entre
              ellos conforme a las reglas publicadas en el Módulo.
            </P>
            <P>
              {'\n'}8.3. El premio equivale al Pozo del Concurso respectivo, según las reglas de cada
              juego, sin que el Organizador retenga importe alguno por su gestión.
            </P>
            <P>
              {'\n'}8.4. <B>Forma y plazo de pago:</B> el premio se paga de forma <B>manual, una vez
              finalizado el torneo</B>, vía <B>Yappy</B> o <B>transferencia bancaria</B>. El Organizador
              pagará el premio dentro de un plazo máximo de <B>treinta (30) días hábiles</B> contados a
              partir de que el ganador haya: (i) completado satisfactoriamente la verificación de
              identidad y edad (Sección 11); y (ii) proporcionado datos válidos y completos para el pago.
              Cualquier demora atribuible a la falta de datos válidos, a verificaciones pendientes o a
              requerimientos legales o fiscales suspende dicho plazo.
            </P>
            <P>
              {'\n'}8.5. El Organizador podrá publicar el nombre o identificador de cuenta del ganador
              dentro del Módulo, conforme a la Sección 14 (protección de datos).
            </P>
          </WCBlock>

          {/* 9 */}
          <WCBlock title="9. Cumplimiento regulatorio y derecho de cese" accent="blue">
            <P>
              9.1. El Organizador podrá <B>suspender, modificar o cancelar el Módulo de manera
              inmediata</B>, total o parcialmente, si: (i) una autoridad competente así lo requiere;
              (ii) surge una duda razonable sobre la calificación o licitud regulatoria de la actividad;
              o (iii) ocurre un evento de fuerza mayor o caso fortuito que impida su operación normal.
            </P>
            <P>
              {'\n'}9.2. En tal caso, la <B>única obligación y responsabilidad del Organizador</B> frente
              al Participante consistirá en <B>acreditar el monto de la inscripción a créditos internos</B>{' '}
              de la cuenta del Participante, sin que proceda indemnización, lucro cesante ni reclamación
              adicional alguna, salvo lo que disponga la ley con carácter irrenunciable.
            </P>
            <P>
              {'\n'}9.3. Lo anterior se entiende sin perjuicio de los <B>derechos irrenunciables del
              consumidor</B> y del derecho del Participante a presentar reclamo conforme a la Sección 17.
            </P>
          </WCBlock>

          {/* 10 */}
          <WCBlock title="10. Obligaciones fiscales" accent="magenta">
            <P>
              10.1. El premio puede estar sujeto a obligaciones fiscales. Salvo disposición legal en
              contrario, <B>los impuestos, tasas o contribuciones que graven el premio corren por cuenta
              del ganador</B>.
            </P>
            <P>
              {'\n'}10.2. Cuando la legislación panameña aplicable lo exija, el Organizador podrá{' '}
              <B>retener montos</B> del premio y/o <B>reportar</B> los pagos a la autoridad
              correspondiente.
            </P>
            <P>
              {'\n'}10.3. Como <B>condición previa al pago</B>, el Organizador podrá solicitar al ganador
              datos fiscales y de identificación (por ejemplo, <B>cédula o RUC</B>). La falta de entrega
              de estos datos faculta al Organizador a <B>retener el premio</B> hasta su cumplimiento.
            </P>
          </WCBlock>

          {/* 11 */}
          <WCBlock title="11. Verificación del ganador (KYC) y edad" accent="neon">
            <P>
              11.1. Antes de pagar cualquier premio, el Organizador realizará una <B>verificación de
              identidad y edad</B> del ganador, que podrá incluir:
            </P>
            <P>
              {'\n'}• acreditación de que el ganador es <B>mayor de 18 años</B>;{'\n'}
              • verificación de su <B>identidad</B> (documento oficial); y{'\n'}
              • confirmación de que el <B>titular de la cuenta de Yappy o cuenta bancaria</B> receptora{' '}
              <B>coincide</B> con la identidad del ganador.
            </P>
            <P>
              {'\n'}11.2. El Organizador se reserva el derecho de <B>retener el premio</B> hasta que la
              verificación se complete satisfactoriamente. Si la verificación no puede completarse o
              revela información falsa, el Organizador podrá <B>descalificar</B> al Participante y
              reasignar el premio conforme a las reglas del Concurso.
            </P>
          </WCBlock>

          {/* 12 */}
          <WCBlock title="12. Prevención de blanqueo de capitales (PBC/AML)" accent="blue">
            <P>
              12.1. Queda <B>prohibido</B> participar con <B>fondos de origen ilícito</B> o vinculados a
              actividades ilegales.
            </P>
            <P>
              {'\n'}12.2. El Organizador podrá, cuando lo estime necesario o cuando la ley lo requiera:
              (i) solicitar información sobre el <B>origen de los fondos</B>; (ii) <B>rechazar, retener o
              revertir</B> pagos que considere sospechosos; y (iii) <B>reportar</B> operaciones a la
              autoridad competente conforme a la legislación panameña aplicable.
            </P>
            <P>
              {'\n'}12.3. Al participar, el Participante declara que los fondos empleados son de{' '}
              <B>origen lícito</B> y de su legítima titularidad.
            </P>
          </WCBlock>

          {/* 13 */}
          <WCBlock title="13. Tiendas de aplicaciones (Apple / Google)" accent="magenta">
            <P>
              13.1. Apple Inc. y Google LLC, así como sus respectivas tiendas y plataformas,{' '}
              <B>no patrocinan, avalan, administran ni operan</B> los Concursos y <B>no son parte</B> de
              este Anexo.
            </P>
            <P>
              {'\n'}13.2. El <B>cobro de la inscripción se realiza fuera del sistema de pago in-app</B> de
              dichas tiendas, por la vía web, conforme a la Sección 6.2.
            </P>
            <P>
              {'\n'}13.3. Cualquier reclamo relacionado con los Concursos debe dirigirse al{' '}
              <B>Organizador</B> y no a Apple ni a Google.
            </P>
          </WCBlock>

          {/* 14 */}
          <WCBlock title="14. Protección de datos personales (Ley 81 de 2019)" accent="neon">
            <P>
              14.1. <B>Responsable del tratamiento:</B> Sergio Bosso (Birrea2Play), persona natural,
              contacto <B>sergio.bosso09@gmail.com</B>.
            </P>
            <P>
              {'\n'}14.2. <B>Datos que se tratan:</B> datos de identificación y contacto, datos de la
              cuenta, predicciones y resultados, medios y datos de pago, y —respecto de ganadores— datos
              de identificación, fiscales y bancarios necesarios para el pago y para el cumplimiento legal.
            </P>
            <P>
              {'\n'}14.3. <B>Finalidades:</B> gestionar la inscripción y participación, calcular puntajes
              y determinar ganadores, procesar pagos de premios, cumplir obligaciones legales, fiscales y
              de prevención de blanqueo, y atender reclamos.
            </P>
            <P>
              {'\n'}14.4. <B>Base de legitimación:</B> la <B>ejecución del contrato</B> de participación,
              el <B>consentimiento</B> del Participante y el <B>cumplimiento de obligaciones legales</B>{' '}
              del Organizador, conforme a la <B>Ley 81 de 2019</B> sobre protección de datos personales de
              la República de Panamá.
            </P>
            <P>
              {'\n'}14.5. <B>Terceros que tratan datos:</B> para operar el Módulo intervienen, entre
              otros, <B>api-football</B> (proveedor de resultados deportivos) y <B>Banco General, S.A. /
              Yappy</B> (procesamiento de pagos). Estos terceros tratan datos conforme a sus propias
              políticas y a la finalidad indicada.
            </P>
            <P>
              {'\n'}14.6. <B>Derechos ARCO:</B> el Participante puede ejercer sus derechos de{' '}
              <B>acceso, rectificación, cancelación (supresión) y oposición</B>, así como la revocación
              del consentimiento, escribiendo a <B>sergio.bosso09@gmail.com</B>. El Organizador atenderá
              la solicitud conforme a la Ley 81 de 2019.
            </P>
            <P>
              {'\n'}14.7. <B>Conservación:</B> los datos de pago e identificación de los <B>ganadores</B>{' '}
              se conservan por el tiempo necesario para cumplir obligaciones legales, fiscales y de
              prevención de blanqueo aplicables; los demás datos se conservan mientras dure la relación y
              los plazos legales correspondientes.
            </P>
            <P>
              {'\n'}14.8. Para mayor detalle, aplica la <B>Política de Privacidad</B> general de
              Birrea2Play.
            </P>
          </WCBlock>

          {/* 15 */}
          <WCBlock title="15. Menores de edad" accent="blue">
            <P>15.1. El Módulo es <B>estrictamente para mayores de 18 años</B>.</P>
            <P>
              {'\n'}15.2. Si el Organizador detecta que un Participante es <B>menor de edad</B>, podrá{' '}
              <B>anular su inscripción sin reembolso en efectivo</B>, sin perjuicio de las obligaciones
              legales aplicables, y eliminar o bloquear su participación de forma inmediata.
            </P>
            <P>
              {'\n'}15.3. El Organizador no recopila intencionalmente datos de menores de edad. Si
              advierte tal situación, procederá conforme a la Sección 14 y a la Ley 81 de 2019.
            </P>
          </WCBlock>

          {/* 16 */}
          <WCBlock title="16. Juego responsable y custodia / continuidad de fondos" accent="gold">
            <P>
              16.1. <B>Juego responsable:</B> la participación debe ser una actividad <B>recreativa y
              moderada</B>. Participe solo con montos que pueda permitirse destinar al entretenimiento. Si
              la participación deja de ser un pasatiempo o le genera preocupación, le recomendamos
              suspenderla y buscar apoyo.
            </P>
            <P>
              {'\n'}16.2. <B>Autoexclusión voluntaria:</B> el Participante puede solicitar, en cualquier
              momento, su <B>baja del Módulo y/o su autoexclusión voluntaria</B> escribiendo al
              Organizador. Atendida la solicitud, no se admitirán nuevas inscripciones de esa cuenta en el
              Módulo. La autoexclusión solicitada después del Congelamiento no genera derecho a reembolso
              de inscripciones ya perfeccionadas, salvo lo dispuesto en la Sección 9.
            </P>
            <P>
              {'\n'}16.3. <B>Custodia de fondos del Pozo:</B> los fondos correspondientes al Pozo se
              mantienen identificados y separados del patrimonio de uso personal del Organizador hasta el
              pago del premio, según la Sección 5.4.
            </P>
            <P>
              {'\n'}16.4. <B>Continuidad ante fallecimiento o incapacidad:</B> en caso de <B>fallecimiento
              o incapacidad</B> del Organizador que impida operar el Módulo, los fondos del Pozo se
              destinarán al pago de los premios pendientes o, de no ser posible determinarlos, a la{' '}
              <B>devolución de las inscripciones</B> a los Participantes mediante acreditación a créditos
              internos o el mecanismo razonablemente disponible, en la medida en que tales fondos puedan
              identificarse.
            </P>
          </WCBlock>

          {/* 17 */}
          <WCBlock title="17. Reclamos y resolución de disputas" accent="magenta">
            <P>
              17.1. <B>Canal de reclamo interno:</B> antes de acudir a otras instancias, el Participante
              puede presentar su reclamo al Organizador escribiendo a <B>sergio.bosso09@gmail.com</B>,
              indicando su identificador de cuenta, el Concurso, una descripción del hecho y la pretensión.
            </P>
            <P>
              {'\n'}17.2. <B>Plazo de respuesta:</B> el Organizador procurará <B>acusar recibo dentro de
              cinco (5) días hábiles</B> y emitir una <B>respuesta de fondo dentro de quince (15) días
              hábiles</B> siguientes a la recepción del reclamo completo.
            </P>
            <P>
              {'\n'}17.3. <B>Decisiones del Organizador:</B> las decisiones del Organizador sobre la
              aplicación de las reglas de los Concursos buscan ser finales en el ámbito operativo del
              Módulo; no obstante, ello <B>no limita ni renuncia</B> el derecho del Participante a
              presentar reclamo ante la <B>Autoridad de Protección al Consumidor y Defensa de la
              Competencia (ACODECO)</B> ni a acudir a los tribunales competentes. Quedan a salvo los{' '}
              <B>derechos irrenunciables del consumidor</B>.
            </P>
            <P>
              {'\n'}17.4. <B>Ley aplicable y jurisdicción:</B> este Anexo se rige por las <B>leyes de la
              República de Panamá</B>. Las controversias se someten a los <B>tribunales de la Ciudad de
              Panamá</B>, sin perjuicio de las instancias de protección al consumidor y de los derechos
              irrenunciables del consumidor.
            </P>
          </WCBlock>

          {/* 18 */}
          <WCBlock title="18. Limitación de responsabilidad" accent="neon">
            <P>
              18.1. Conforme a los Términos Generales, la responsabilidad total del Organizador frente al
              Participante, por cualquier causa relacionada con el Módulo, <B>no excederá el monto
              efectivamente pagado</B> por dicho Participante en los <B>noventa (90) días</B> anteriores
              al hecho que origine la reclamación.
            </P>
            <P>
              {'\n'}18.2. El Organizador no responde por fallas, interrupciones o errores de{' '}
              <B>terceros</B> (proveedores de datos, plataformas de pago, tiendas de aplicaciones,
              proveedores de conectividad), salvo lo dispuesto por la ley con carácter irrenunciable.
            </P>
            <P>
              {'\n'}18.3. Nada en esta sección excluye o limita la responsabilidad que, conforme a la
              legislación panameña aplicable, <B>no pueda ser excluida o limitada</B>.
            </P>
          </WCBlock>

          {/* 19 */}
          <WCBlock title="19. Cesión" accent="blue">
            <P>
              19.1. El Participante <B>no puede ceder, transferir ni delegar</B> su inscripción, su
              posición en el Concurso ni su derecho al premio, a ningún título.
            </P>
            <P>
              {'\n'}19.2. El Organizador <B>podrá ceder o transferir</B> la operación del Módulo o sus
              derechos y obligaciones a un tercero, siempre que ello no menoscabe los derechos adquiridos
              del Participante.
            </P>
          </WCBlock>

          {/* 20 */}
          <WCBlock title="20. Disposiciones generales" accent="magenta">
            <P>
              20.1. <B>Divisibilidad (severability):</B> si alguna disposición de este Anexo se declara
              inválida o inejecutable, las demás disposiciones conservarán plena vigencia.
            </P>
            <P>
              {'\n'}20.2. <B>Acuerdo íntegro:</B> este Anexo, junto con los Términos Generales, la
              Política de Privacidad y las reglas publicadas dentro del Módulo, constituyen el{' '}
              <B>acuerdo íntegro</B> entre las partes respecto del Módulo Mundial.
            </P>
            <P>
              {'\n'}20.3. <B>No renuncia:</B> la tolerancia o el no ejercicio por parte del Organizador de
              algún derecho previsto en este Anexo <B>no constituye renuncia</B> a ese ni a otros derechos.
            </P>
            <P>
              {'\n'}20.4. <B>Modificaciones:</B> el Organizador podrá actualizar este Anexo por razones
              legales, regulatorias u operativas. Los cambios sustanciales se comunicarán por los medios
              habituales del Módulo. El uso continuado tras la entrada en vigor de una nueva versión
              implica su aceptación, sin perjuicio de los derechos irrenunciables del consumidor.
            </P>
          </WCBlock>

          {/* 21 */}
          <WCBlock title="21. Constancia de aceptación" variant="light">
            <P light>
              21.1. Al <B light>marcar la casilla de aceptación e inscribirse</B> en cualquiera de los
              Concursos del Módulo, el Participante <B light>declara haber leído, entendido y aceptado</B>{' '}
              este Anexo, los Términos Generales y la Política de Privacidad.
            </P>
            <P light>
              {'\n'}21.2. El Organizador <B light>registrará</B> la aceptación, dejando constancia de la{' '}
              <B light>versión</B> del documento aceptada, la <B light>fecha y hora</B> de la aceptación y
              el <B light>identificador de la cuenta</B> del Participante.
            </P>
            <P light>
              {'\n'}21.3. Dicho registro <B light>podrá presentarse como medio de prueba</B> de la
              aceptación, <B light>sin perjuicio de la libre valoración judicial</B> y de las demás
              pruebas que las partes puedan aportar.
            </P>
          </WCBlock>

          <Text style={styles.footer}>
            Birrea2Play — Módulo Mundial. Versión 1.1. Fecha de vigencia: junio de 2026.
            Contacto: sergio.bosso09@gmail.com — birrea2play.com
          </Text>

          <WCButton
            label="VER VERSIÓN WEB"
            variant="ghost"
            size="lg"
            leadingIcon="🌐"
            onPress={() => Linking.openURL(TERMS_WEB_URL)}
            style={{ marginTop: SPACING.lg }}
          />

          <WCButton
            label="VOLVER"
            variant="ghost"
            size="lg"
            onPress={() => navigation.goBack()}
            style={{ marginTop: SPACING.sm }}
          />
        </ScrollView>
      </SafeAreaView>
    </MundialScreenFrame>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  text: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 20,
  },
  textLight: {
    color: COLORS.bg,
  },
  bold: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.white,
  },
  boldLight: {
    color: COLORS.bg,
  },
  subText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray,
    fontStyle: 'italic',
    marginTop: SPACING.sm,
    lineHeight: 16,
  },
  versionRow: {
    marginBottom: SPACING.sm,
  },
  footer: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: SPACING.lg,
    lineHeight: 16,
  },
});
