-- The render film strip: each finished render of a model, kept beside it so the model file stays small. The shot's
-- settings live in the model (ModelDoc.renders); this holds the picture and the key of the model it was made from,
-- so the editor can tell a picture that is out of date.
CREATE TABLE renders (
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL,
  image TEXT NOT NULL,
  key TEXT NOT NULL,
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY (model_id, shot_id)
);
