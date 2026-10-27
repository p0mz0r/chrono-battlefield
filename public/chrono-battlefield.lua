obs = obslua
source_name = ""
hotkeys = {}
actions = { "start", "pause", "end", "camera", "mute" }
labels = { "Start race", "Pause / resume", "End race (press twice)", "Camera mode", "Mute" }

function send(action)
  local source = obs.obs_get_source_by_name(source_name)
  if source == nil then return end
  if obs.obs_source_get_id(source) == "browser_source" then
    local data = obs.calldata_create()
    obs.calldata_set_string(data, "eventName", "chronoOperator")
    obs.calldata_set_string(data, "jsonString", '{"action":"' .. action .. '"}')
    obs.proc_handler_call(obs.obs_source_get_proc_handler(source), "javascript_event", data)
    obs.calldata_destroy(data)
  end
  obs.obs_source_release(source)
end

function script_description()
  return "Sends global OBS hotkeys to the Rhino Race browser source. Select that source below, then bind keys in Settings > Hotkeys."
end

function script_properties()
  local props = obs.obs_properties_create()
  local list = obs.obs_properties_add_list(props, "source", "Rhino Race browser source", obs.OBS_COMBO_TYPE_EDITABLE, obs.OBS_COMBO_FORMAT_STRING)
  local sources = obs.obs_enum_sources()
  if sources ~= nil then
    for _, source in ipairs(sources) do
      if obs.obs_source_get_id(source) == "browser_source" then
        local name = obs.obs_source_get_name(source)
        obs.obs_property_list_add_string(list, name, name)
      end
    end
    obs.source_list_release(sources)
  end
  return props
end

function script_update(settings)
  source_name = obs.obs_data_get_string(settings, "source")
end

function script_load(settings)
  for i, action in ipairs(actions) do
    local key = "chrono_battlefield." .. action
    hotkeys[i] = obs.obs_hotkey_register_frontend(key, "Rhino Race: " .. labels[i], function(pressed)
      if pressed then send(action) end
    end)
    local saved = obs.obs_data_get_array(settings, key)
    obs.obs_hotkey_load(hotkeys[i], saved)
    obs.obs_data_array_release(saved)
  end
end

function script_save(settings)
  for i, action in ipairs(actions) do
    local key = "chrono_battlefield." .. action
    local saved = obs.obs_hotkey_save(hotkeys[i])
    obs.obs_data_set_array(settings, key, saved)
    obs.obs_data_array_release(saved)
  end
end
