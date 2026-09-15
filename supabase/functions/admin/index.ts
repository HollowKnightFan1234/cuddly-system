import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const userClient = createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const {data:{user},error:userError}=await userClient.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    const adminClient = createClient(url,service);
    const {data:profile}=await adminClient.from("profiles").select("is_admin").eq("id",user.id).single();
    if (!profile?.is_admin) throw new Error("Administrator access required");

    const body = await req.json();

    if(body.action==="create"){
      if(!body.email || !body.password) throw new Error("Email and password are required");
      const {data:newUser,error}=await adminClient.auth.admin.createUser({
        email:body.email,
        password:body.password,
        email_confirm:true,
        user_metadata:{display_name:body.display_name || body.email.split("@")[0]}
      });
      if(error) throw error;
      if(newUser.user) {
        await adminClient.from("profiles").update({
          display_name:body.display_name || body.email.split("@")[0]
        }).eq("id",newUser.user.id);
      }
      return Response.json({ok:true,user_id:newUser.user?.id},{headers:cors});
    }

    if(body.action==="delete"){
      if(!body.user_id) throw new Error("User ID required");
      if(body.user_id===user.id) throw new Error("You cannot delete yourself");
      const {error}=await adminClient.auth.admin.deleteUser(body.user_id);
      if(error) throw error;
      return Response.json({ok:true},{headers:cors});
    }

    throw new Error("Unknown action");
  } catch(error) {
    return Response.json({error:error instanceof Error ? error.message : "Unknown error"},{status:400,headers:cors});
  }
});
