# Voice options for Ava

Checked 2 October 2026. Retell's list-voices response includes `voice_id`, `voice_name`, `gender`, `accent`, `age`, and `preview_audio_url`. That list requires an API key, so this page does not invent ids.

The voice reference publishes one binding: voice id `retell-Cimo`, example name Adrian, preview [adrian.mp3](https://retell-utils-public.s3.us-west-2.amazonaws.com/adrian.mp3).

These preview files also responded `200` that day. They are the public samples whose names match voices Retell has shipped. The id on the dashboard card is the value to copy. Do not assume the file name is the id.

| Preview | Link |
| --- | --- |
| Adrian (documented id `retell-Cimo`) | https://retell-utils-public.s3.us-west-2.amazonaws.com/adrian.mp3 |
| Grace | https://retell-utils-public.s3.us-west-2.amazonaws.com/grace.mp3 |
| Emily | https://retell-utils-public.s3.us-west-2.amazonaws.com/emily.mp3 |
| Lily | https://retell-utils-public.s3.us-west-2.amazonaws.com/lily.mp3 |
| Chloe | https://retell-utils-public.s3.us-west-2.amazonaws.com/chloe.mp3 |
| Marissa | https://retell-utils-public.s3.us-west-2.amazonaws.com/marissa.mp3 |
| Myra | https://retell-utils-public.s3.us-west-2.amazonaws.com/myra.mp3 |
| Kate | https://retell-utils-public.s3.us-west-2.amazonaws.com/kate.mp3 |

Platform voices are the ones tuned for phone audio, with fallback included. Prefer those over a raw provider voice when the card says platform. [Platform voices](https://docs.retellai.com/build/platform-voices).

## Chosen voices (Phase 4)

The wizard labels map to Retell voice ids in `packages/providers/src/voices.ts`. That file is the only place to change a voice; the wizard, the admin client page, change review, and the Retell payload all read it. `RETELL_DEFAULT_VOICE_ID` is gone.

| Wizard label | Shown as | Retell `voice_id` |
| --- | --- | --- |
| `voice_1` (default for new clients) | Brynne (female) | `retell-Brynne` |
| `voice_2` | Della (female) | `retell-Della` |
| `voice_3` | Cimo (female) | `retell-Cimo` |
| `voice_4` | Jason (male) | `minimax-Jason` |
