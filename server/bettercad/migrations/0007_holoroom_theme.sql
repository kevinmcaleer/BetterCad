-- The Holodeck theme is now called Holoroom: accounts that chose it keep it under its new id.
UPDATE accounts SET theme = 'holoroom' WHERE theme = 'holodeck';
