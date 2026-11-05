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

aceptación con una cuenta de prueba.
