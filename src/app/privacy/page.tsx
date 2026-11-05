import Link from 'next/link';

export const metadata = { title: 'Privacidad y uso de IA · O-CLOÜD' };

export default function PrivacyPage() {
  return <main className="legal-page"><div className="eyebrow">O-CLOÜD · INFORMACIÓN</div><h1>Privacidad y uso de IA</h1><p className="legal-updated">Resumen informativo de la versión actual de la aplicación.</p>
    <section><h2>Datos y almacenamiento</h2><p>La autenticación se gestiona con Supabase Auth. El nombre de perfil, prendas, outfits, calendario y resultados que guardes se asocian a tu cuenta. Las fotografías se guardan en buckets privados y se sirven mediante enlaces temporales autenticados. La política RLS de la base de datos limita las filas al propietario.</p></section>
    <section><h2>Servicios externos opcionales</h2><p>Si se configura Clipdrop, la foto de una prenda se envía para eliminar su fondo. Si se configura OpenAI, el estilista puede enviar nombres, categorías, colores y clima, sin fotografías. El clima puede consultarse mediante Open-Meteo después de que permitas usar la ubicación del dispositivo; las coordenadas no se guardan en O-CLOÜD.</p><p>El probador virtual usa FASHN cuando el servidor tiene una clave válida. Solo al seleccionar una imagen y marcar el consentimiento se envían la foto personal y la imagen de una prenda. O-CLOÜD no guarda la foto personal recibida; el proveedor procesa esa imagen según sus propias condiciones y puede conservar registros de solicitudes. El resultado generado se almacena en el espacio privado y puede eliminarse desde la interfaz.</p></section>
    <section><h2>Imágenes generadas</h2><p>Las pruebas virtuales son representaciones de IA, no mediciones ni simulaciones físicas. No garantizan identidad, talla, proporciones exactas, caída de tela o ajuste. El sistema no usa tus imágenes para entrenar modelos propios.</p></section>
    <section><h2>Control de tus datos</h2><p>Puedes eliminar prendas, outfits y resultados desde la aplicación y cerrar sesión desde Perfil. La eliminación completa de la cuenta requiere actualmente gestionarse desde el proyecto Supabase; la función de autoservicio para borrar la cuenta aún no está implementada.</p></section>
    <p className="legal-disclaimer">Este resumen describe el comportamiento técnico actual; no es un aviso legal completo. Antes de operar públicamente o en una jurisdicción concreta, revisa con asesoría legal los términos, plazos de conservación, derechos y contratos de proveedores aplicables.</p><Link href="/" className="text-button">← Volver a O-CLOÜD</Link>
  </main>;
}
