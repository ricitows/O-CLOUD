# O-CLOÜD

Aplicación editorial de armario digital construida con Next.js, React y TypeScript. La interfaz es responsive. Supabase Auth usa sesiones SSR en cookies; la persistencia de perfil requiere aplicar la migración incluida y configurar un proyecto propio.

## Requisitos

- Node.js 20.9 o posterior
- npm

## Desarrollo

```bash
npm install
npm run dev
```

 El archivo original de marca se conserva en `Icon.png`; el frontend ya no carga `public/icon.png`.

## Conectar Supabase

1. Crea un proyecto Supabase y copia `.env.example` a `.env.local`.
2. En el panel de Supabase, copia el Project URL y la Publishable key a `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Define `NEXT_PUBLIC_SITE_URL` con `http://localhost:3000` en local y con el dominio de producción al desplegar.
3. Solo en un proyecto Supabase nuevo, ejecuta en orden las migraciones `supabase/migrations/202610220001_initial_schema.sql` y `supabase/migrations/202610220002_enhancements.sql`. Si esas migraciones ya se ejecutaron en tu proyecto, no las vuelvas a ejecutar.
4. En Authentication, permite email y contraseña, activa la confirmación de correo y añade `http://localhost:3000/auth/confirm` y el dominio real con `/auth/confirm` a las URL de redirección permitidas.
5. Reinicia `npm run dev`, crea una cuenta en `/register`, confirma el correo y entra en `/login`.

### Supabase Edge Functions para Clipdrop, Tripo y OpenAI

Las claves de estas tres integraciones se leen únicamente en Edge Functions. No las pongas en `.env.local`, en `NEXT_PUBLIC_*` ni en el frontend. En Supabase → Edge Functions → Secrets configura:

- `CLIPDROP_API_KEY` — solo `remove-background`.
- `TRIPO_API_KEY` — solo `generate-3d`.
- `OPENAI_API_KEY` — solo `garment-assistant`.
- Opcional: `OPENAI_STYLIST_MODEL` — modelo de Responses API; por defecto `gpt-5.4-mini`.

Supabase proporciona a las funciones `SUPABASE_URL` y `SUPABASE_ANON_KEY`; el código usa la sesión del usuario y RLS, no una clave `service_role`. Cada función también valida al usuario y limita las consultas a su inventario/archivos. Clipdrop, Tripo y OpenAI verifican una autorización explícita de gasto por operación. OpenAI recibe nombres/categorías/colores/clima y no recibe fotografías; `garment-assistant` se reserva para recomendaciones opcionales, porque JavaScript cubre la recomendación gratuita.

No ejecutes ni vuelvas a ejecutar migraciones para instalar estas funciones. El esquema actual ya contiene `processing_jobs` y `garments.model_3d_path`; estas funciones reutilizan esas estructuras.

Desde PowerShell, con Supabase CLI instalado:

```powershell
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy remove-background
supabase functions deploy generate-3d
supabase functions deploy garment-assistant
```

`<PROJECT_REF>` es el ID del proyecto mostrado en Supabase → Project Settings → General. Configura antes los secretos en el panel (Edge Functions → Secrets), o usa la administración segura de secretos del CLI en tu máquina. Nunca pegues las claves en el chat ni las subas al repositorio. El despliegue no llama a los proveedores ni consume sus créditos.

### Probar las integraciones sin cargos sorpresa

1. Sin configurar una clave, prueba añadir una prenda sin marcar Clipdrop: debe guardarla en Supabase como imagen original. Si marcas Clipdrop sin clave, debe mostrar la falta de configuración y guardar igualmente el original.
2. Configura `CLIPDROP_API_KEY`, despliega `remove-background` y, solo si aceptas posible gasto, marca el consentimiento al añadir una prenda. La función devuelve PNG validado o un error legible; la app conserva el original ante fallos.
3. Configura `TRIPO_API_KEY` y despliega `generate-3d`. En Closet, la generación requiere confirmación por intento. La tarea y el GLB se asocian solo a la prenda del usuario; el límite es tres generaciones por 24 horas.
4. Sin `OPENAI_API_KEY`, marca OpenAI para una sugerencia: debe informar que no está configurado y mostrar la recomendación JavaScript. Con la clave y la función desplegadas, la llamada solo ocurre al marcar la autorización de gasto para esa sugerencia.
5. En todos los casos, desmarca las opciones de pago para confirmar que el modo gratuito continúa funcionando. No es necesario ejecutar pruebas de generación real para verificar ese modo.

Las Edge Functions pueden ejecutarse dentro de la cuota gratuita de Supabase, sujeta a los límites vigentes del plan. El uso de Clipdrop, Tripo y OpenAI puede consumir créditos de proveedor; por eso la aplicación no los invoca automáticamente.

### Eliminación de fondo opcional

El endpoint privado puede procesar imágenes con Clipdrop si `CLIPDROP_API_KEY` está configurada. La carga nunca lo llama automáticamente: se requiere marcar una confirmación de gasto para esa prenda; sin marca o sin clave, se guarda la imagen original y Closet sigue funcionando. El servidor valida el PNG transparente resultante. El límite es 10 procesamientos por usuario cada 24 horas.

### Outfits, calendario, clima y estilista

Outfits y asignaciones de calendario usan tablas privadas con RLS. Se permite un solo outfit por día; al asignar otro se reemplaza el anterior. El calendario limita sus consultas a 63 días y las notas a 500 caracteres.

La sugerencia de clima solicita permiso de geolocalización al pulsar el botón, consulta Open-Meteo en el servidor y no guarda las coordenadas. Open-Meteo publica su API estándar con licencia CC BY 4.0; confirma sus requisitos comerciales antes de un lanzamiento de pago. Las recomendaciones se calculan en JavaScript y no necesitan clave de IA. OpenAI es opcional: aunque `OPENAI_API_KEY` exista, no se llama salvo que el usuario marque el consentimiento de posible gasto en esa recomendación. Solo entonces se envían al modelo nombres, categorías, colores y clima, nunca imágenes corporales; el servidor valida los IDs seleccionados y mantiene límite de 20 llamadas cada 24 horas.

FASHN y Tripo también son optativos y no se invocan por tener una clave configurada. Cada generación requiere confirmación de posible consumo de créditos en la interfaz y un parámetro de autorización validado por el servidor. Si faltan claves, se muestra el estado de integración y las funciones gratuitas y el resto de la aplicación continúan disponibles.

No añadas claves `service_role` a variables públicas. `.env.local` está excluido de Git.

## Funcionalidad implementada

- Registro, inicio y cierre de sesión, confirmación de correo y recuperación de contraseña con Supabase Auth; sesión SSR en cookies y ruta principal protegida.
- Perfil de nombre para mostrar persistido con RLS. Se incluye el resumen técnico de privacidad en `/privacy`.
- Navegación responsive entre Inicio, Closet, Outfits y Perfil, con el icono de marca original.
- Closet privado con carga, validación de firma/tipo/tamaño, edición de nombre/categoría/subcategoría/color, filtros, orden, favoritos y borrado.
- Eliminación de fondo integrada mediante `remove-background`; la clave va en Supabase Edge Function Secrets. Si falta la clave o falla el proveedor, la prenda se guarda como original y el Closet sigue disponible.
- Creación, favorito y borrado de outfits basados en prendas reales. Calendario mensual/semanal persistente con una asignación por día; asignar otro outfit reemplaza al existente.
- Estilista con clima real de Open-Meteo y selección de prendas propias. OpenAI es opcional; sin clave, se usa la curaduría por reglas, identificada en pantalla.
- Probador de FASHN integrado al flujo: consentimiento explícito, una prenda por generación, límite de tres pruebas cada 24 h, consulta de créditos, foto personal no guardada en O-CLOÜD, resultados privados eliminables y avisos de limitaciones. Requiere `FASHN_API_KEY` y cuenta con créditos.
- Reconstrucción 3D integrada con Tripo: procesa la imagen privada JPG/PNG de una prenda, limita a tres generaciones por usuario cada 24 h, consulta una tarea asíncrona y guarda el GLB de vuelta en almacenamiento privado. Requiere `TRIPO_API_KEY`. Por ahora el Closet ofrece enlace temporal al GLB; el visor interactivo con rotación/zoom aún falta.

## Pendientes de despliegue y aceptación final

Las funciones Edge deben desplegarse en el proyecto Supabase que ya usa la aplicación. Este cambio no requiere migraciones: conserva el esquema y los datos actuales. Si ya ejecutaste las migraciones, no las repitas. Después del despliegue, verifica autenticación/CRUD y las funciones con los pasos anteriores.

Las claves de Clipdrop, OpenAI, FASHN y Tripo son opcionales y no están presentes en `.env.example` como valores. Añade las claves de Clipdrop, OpenAI y Tripo a Supabase Edge Function Secrets; FASHN conserva su ruta Next.js y su configuración server-side existente. La generación 3D está preparada conforme a la carga de archivos, endpoint image-to-model y flujo de tareas descritos en la [documentación oficial de Tripo](https://developers.tripo3d.com/en/docs/generation-image-to-model/standard), pero requiere prueba contra una cuenta real; una vista única solo estima volumen y no representa un escaneo exacto ni captura 360°. No hay visor interactivo con rotación/zoom, interfaz de perfil corporal, borrado autoservicio de cuenta, edición/duplicado completo de outfits ni suite automatizada de pruebas. El resumen `/privacy` no sustituye términos ni aviso legal revisados para el país de operación.

## Comprobaciones y despliegue

Comprobaciones locales: `npm run lint`, `npx tsc --noEmit` y `npm run build`. El CRUD de Supabase y proveedores requiere una sesión configurada con acceso a red y credenciales válidas, y no se considera probado hasta generar resultados reales. Para desplegar, configura las variables de `.env.example` como secretos del servidor en un host compatible con Next.js, aplica las dos migraciones, añade URLs de redirección de Auth para el dominio real y realiza los flujos de aceptación con una cuenta de prueba.
