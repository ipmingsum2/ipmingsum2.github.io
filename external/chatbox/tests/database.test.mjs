import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db;
const root = "00000000-0000-4000-8000-000000000001",
  alice = "00000000-0000-4000-8000-000000000002",
  bob = "00000000-0000-4000-8000-000000000003",
  mod = "00000000-0000-4000-8000-000000000004";
async function call(user, action, payload = {}) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  return (
    await db.query("select public.chat_action($1,$2::jsonb) result", [
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create table public.profiles(id uuid,username text,display_name text,role text,avatar_url text);
create table public.channels(id text,name text,created_by uuid,is_private boolean,is_locked boolean,sort_order bigint);
create table public.messages(id uuid,room text,user_id uuid,text text,image_url text,created_at timestamptz,deleted boolean);
grant select,insert,update on public.messages to authenticated;
create table public.announcements(id uuid,title text,body text,created_by uuid,created_at timestamptz,is_pinned boolean,pinned_at timestamptz);
insert into public.announcements values('22222222-2222-4222-8222-222222222222','Existing announcement','Keep this separate','${root}','2026-01-01',true,'2026-01-02');
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(id text primary key,bucket_id text,name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:cardinality(string_to_array(name,'/'))-1]$$;
grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;alter table storage.objects enable row level security;
insert into auth.users(id,email) values('${root}','root@local.chat'),('${alice}','alice@example.test'),('${bob}','bob@example.test'),('${mod}','mod@example.test');
insert into public.profiles values('${root}','root','Root','admin',null),('${alice}','alice','Alice','user',null),('${bob}','bob','Bob','user',null),('${mod}','mod','Mod','user',null);
insert into public.channels values('lobby','lobby','${root}',false,false,0);
insert into public.messages values('11111111-1111-4111-8111-111111111111','lobby','${alice}','Legacy hello',null,now(),false);`);
  await db.exec(
    await readFile(
      new URL(
        "../../../supabase/migrations/202609280001_chatbox_v2.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../../supabase/migrations/202609280002_chatbox_private_media.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
after(async () => {
  await db?.close();
});
test("legacy messages and channels retained without seeded defaults; root identity is immutable", async () => {
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','public.messages','INSERT') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from chat_private.legacy_acl where table_name='messages' and grantee='authenticated'",
      )
    ).rows[0].n,
    3,
  );
  const boot = await call(root, "bootstrap");
  assert.equal(boot.root, true);
  assert.equal(
    (await db.query("select count(*)::int n from public.cb_messages")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.messages")).rows[0].n,
    1,
  );
  assert.deepEqual(
    (
      await db.query(
        "select id,name,sort_order from public.cb_channels order by id",
      )
    ).rows,
    (
      await db.query(
        "select id,name,sort_order from public.channels order by id",
      )
    ).rows,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.cb_categories")).rows[0]
      .n,
    0,
  );
  await assert.rejects(
    call(alice, "profile", { username: "root", display_name: "Fake root" }),
    /reserved/,
  );
});
test("only root assigns and removes Owner, admins cannot escalate", async () => {
  await assert.rejects(
    call(alice, "role", { user_id: alice, role: "Owner", remove: false }),
    /Only root/,
  );
  await call(root, "role", { user_id: alice, role: "Owner", remove: false });
  await assert.rejects(
    call(alice, "role", { user_id: bob, role: "Administrator", remove: false }),
    /Only root/,
  );
  await call(root, "role", { user_id: alice, role: "Owner", remove: true });
  assert.deepEqual(
    (
      await db.query("select roles from public.cb_profiles where id=$1", [
        alice,
      ])
    ).rows[0].roles,
    [],
  );
});
test("private channels enforce view, send, and explicit member overrides", async () => {
  const ch = await call(root, "channel", { name: "private", is_private: true });
  await assert.rejects(
    call(alice, "send", { channel_id: ch.id, text: "invisible" }),
    /cannot send/,
  );
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "view",
    value: true,
  });
  await call(alice, "send", { channel_id: ch.id, text: "allowed" });
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "send",
    value: false,
  });
  await assert.rejects(
    call(alice, "send", { channel_id: ch.id, text: "denied" }),
    /cannot send/,
  );
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "send",
    value: null,
  });
  await call(alice, "send", { channel_id: ch.id, text: "inherited" });
});
test("DMs stay participant-only even for root and are idempotent", async () => {
  const dm = await call(alice, "dm", { user_id: bob });
  assert.equal((await call(bob, "dm", { user_id: alice })).id, dm.id);
  await call(alice, "send", { channel_id: dm.id, text: "private dm" });
  assert.equal(
    (await db.query("select public.cb_can($1,$2,'view') ok", [root, dm.id]))
      .rows[0].ok,
    false,
  );
  await assert.rejects(
    call(root, "send", { channel_id: dm.id, text: "intrusion" }),
    /cannot send/,
  );
});
test("AutoMod blocks words and regex on send AND edit, permits allowed phrases", async () => {
  await call(root, "automod", {
    id: "rule-1",
    name: "test",
    words: ["bad"],
    patterns: ["s[p]+am"],
    allowed_words: ["badminton"],
    block_message: "Custom stop",
  });
  assert.equal(
    (await call(alice, "send", { channel_id: "lobby", text: "BAD words" }))
      .message,
    "Custom stop",
  );
  assert.equal(
    (await call(alice, "send", { channel_id: "lobby", text: "sppam" })).blocked,
    true,
  );
  const msg = await call(alice, "send", {
    channel_id: "lobby",
    text: "badminton",
  });
  assert.ok(msg.id);
  assert.equal(
    (await call(alice, "edit", { id: msg.id, text: "bad" })).blocked,
    true,
  );
  await assert.rejects(
    call(root, "automod", { name: "broken", patterns: ["["] }),
    /regular expression/,
  );
});
test("cross-channel replies, other people’s edits, and mass mentions are rejected", async () => {
  const msg = await call(alice, "send", { channel_id: "lobby", text: "hello" });
  await assert.rejects(
    call(bob, "edit", { id: msg.id, text: "owned" }),
    /own messages/,
  );
  await assert.rejects(
    call(alice, "send", { channel_id: "lobby", text: "@everyone hello" }),
    /mention everyone/,
  );
  const dm = await call(alice, "dm", { user_id: bob });
  await assert.rejects(
    call(alice, "send", { channel_id: dm.id, text: "reply", reply_to: msg.id }),
    /Reply target/,
  );
});
test("warnings require acknowledgement, bans revoke access, lower roles cannot moderate upward", async () => {
  await call(root, "role", { user_id: mod, role: "Moderator", remove: false });
  await assert.rejects(
    call(mod, "moderate", { user_id: root, action: "ban", reason: "no" }),
    /cannot moderate/,
  );
  await call(mod, "moderate", {
    user_id: bob,
    action: "warning",
    reason: "Test warning",
  });
  await assert.rejects(
    call(bob, "send", { channel_id: "lobby", text: "still blocked" }),
    /moderation notice/,
  );
  const warning = (
    await db.query(
      "select id from public.cb_moderation where user_id=$1 and action='warning'",
      [bob],
    )
  ).rows[0];
  await call(bob, "acknowledge", { id: warning.id });
  await call(bob, "send", { channel_id: "lobby", text: "acknowledged" });
  await call(mod, "moderate", {
    user_id: bob,
    action: "ban",
    reason: "Test ban",
  });
  await assert.rejects(
    call(bob, "dm", { user_id: alice }),
    /moderation notice/,
  );
  await call(mod, "moderate", {
    user_id: bob,
    action: "unban",
    reason: "Restored",
  });
});
test("bots use hashed, revocable tokens and cannot gain staff roles", async () => {
  const bot = await call(root, "create_bot", { name: "Test app" });
  assert.ok(bot.token.startsWith("cb_"));
  const row = (
    await db.query("select token_hash from public.cb_bots where id=$1", [
      bot.id,
    ])
  ).rows[0];
  assert.notEqual(row.token_hash, bot.token);
  const sent = await db.query(
    "select public.chat_bot($1,$2,$3::jsonb) result",
    [
      "send",
      bot.token,
      JSON.stringify({ channel_id: "lobby", text: "Hello from bot" }),
    ],
  );
  assert.ok(sent.rows[0].result.id);
  await assert.rejects(
    call(root, "role", { user_id: bot.id, role: "Owner", remove: false }),
    /Bots cannot/,
  );
  await call(root, "revoke_bot", { id: bot.id });
  await assert.rejects(
    db.query("select public.chat_bot('me',$1,'{}')", [bot.token]),
    /Invalid bot token/,
  );
});
test("authenticated users cannot write directly, read private DMs, or read token hashes", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [root]);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      db.exec("update public.cb_profiles set roles=array['Owner']"),
      /permission denied/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.cb_messages where room like 'dm-%'",
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      db.exec("select token_hash from public.cb_bots"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select chat_private.dispatch($1,'role','{}')", [root]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("slowmode is per member and channel, survives deletion, allows edits and manager bypass", async () => {
  const ch = await call(root, "channel", {
    name: "Slow conversation",
    slowmode_seconds: 30,
  });
  const blocked = await call(alice, "send", { channel_id: ch.id, text: "bad" });
  assert.equal(blocked.blocked, true);
  const first = await call(alice, "send", {
    channel_id: ch.id,
    text: "First allowed message",
  });
  assert.ok(first.id, "AutoMod rejection must not start cooldown");
  const fast = await call(alice, "send", {
    channel_id: ch.id,
    text: "Too soon",
  });
  assert.equal(fast.slowmode, true);
  assert.ok(fast.retry_after > 0 && fast.retry_after <= 30);
  assert.ok(
    (
      await call(bob, "send", {
        channel_id: ch.id,
        text: "Independent cooldown",
      })
    ).id,
  );
  assert.ok(
    (
      await call(alice, "edit", {
        id: first.id,
        text: "Edited during cooldown",
      })
    ).id,
  );
  await call(alice, "delete_message", { id: first.id });
  assert.equal(
    (
      await call(alice, "send", {
        channel_id: ch.id,
        text: "Deletion cannot bypass",
      })
    ).slowmode,
    true,
  );
  assert.equal(
    (await call(alice, "channel_status", { channel_id: ch.id })).bypass,
    false,
  );
  assert.equal(
    (await call(root, "channel_status", { channel_id: ch.id })).bypass,
    true,
  );
  assert.ok(
    (await call(root, "send", { channel_id: ch.id, text: "Manager one" })).id,
  );
  assert.ok(
    (await call(root, "send", { channel_id: ch.id, text: "Manager two" })).id,
  );
  await db.query(
    "update chat_private.slowmode set last_sent=clock_timestamp()-interval '31 seconds' where actor=$1 and channel_id=$2",
    [alice, ch.id],
  );
  assert.ok(
    (await call(alice, "send", { channel_id: ch.id, text: "Cooldown expired" }))
      .id,
  );
  await call(root, "channel", {
    channel_id: ch.id,
    name: "Slow conversation",
    slowmode_seconds: 0,
  });
  assert.ok(
    (
      await call(alice, "send", {
        channel_id: ch.id,
        text: "Slowmode switched off",
      })
    ).id,
  );
  await assert.rejects(
    call(root, "channel", { name: "Invalid slowmode", slowmode_seconds: -1 }),
    /Slowmode/,
  );
});

test("announcements keep original pins and dates without becoming a default channel", async () => {
  const original = (await db.query("select * from public.announcements"))
      .rows[0],
    copy = (await db.query("select * from public.cb_announcements")).rows[0];
  assert.deepEqual(copy, original);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.cb_channels where id='announcements'",
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    call(alice, "announcement", { title: "Not allowed", body: "test" }),
    /Administrator/,
  );
  await call(root, "announcement", {
    id: copy.id,
    title: copy.title,
    body: "Updated",
    is_pinned: false,
  });
  assert.equal(
    (
      await db.query(
        "select is_pinned from public.cb_announcements where id=$1",
        [copy.id],
      )
    ).rows[0].is_pinned,
    false,
  );
});
test("private attachment access follows channel permissions, including with a broad unrelated storage policy", async () => {
  const ch = await call(root, "channel", {
    name: "Media private",
    is_private: true,
  });
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "view",
    value: true,
  });
  const path = alice + "/" + ch.id + "/clip.mp3";
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice,
  ]);
  await db.exec("set role authenticated");
  try {
    await db.query(
      "insert into storage.objects values('clip','chatbox-private',$1)",
      [path],
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects values('spoof','chatbox-private',$1)",
        [bob + "/" + ch.id + "/clip.mp3"],
      ),
      /row-level security/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
      1,
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec(
    "create policy unrelated_broad_read on storage.objects for select to authenticated using(true)",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
  await db.exec("set role authenticated");
  try {
    assert.equal(
      (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
      0,
    );
    await assert.rejects(
      db.exec("select * from chat_private.root_account"),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
  await assert.rejects(
    call(bob, "send", {
      channel_id: "lobby",
      text: "File",
      image_url: "cb-media:" + path,
    }),
    /another user or channel/,
  );
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "view",
    value: false,
  });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice,
  ]);
  await db.exec("set role authenticated");
  try {
    assert.equal(
      (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
      0,
    );
  } finally {
    await db.exec("reset role");
  }
});
