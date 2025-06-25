# 90s Interdimensional Phone Network Backend

## Description

90s Interdimensional Phone is a backend that runs on a Raspberry Pi.

This project brings AI characters to life through a retro 90s landline phone. You can read the full story here [90s Interdimensional Phone Story](https://median.com).


### Hardware Requirements

The hardware used in this project includes:

- Raspberry Pi 4 (with an SD card)
- ATT 210 Landline Phone
- FlyingVoice FTA1101 VoIP Adapter

### Software Requirements
- Raspberry Pi OS (Raspbian)
- Node.js (v22 or higher)
- Yarn (v1.22 or higher)
- Asterisk with FreePBX (for VoIP phone system)

This server is responsible for taking and making phone calls. The VoIP phone system is a software called Asterisk with FreePBX and will need to be installed and setup on the Raspberry Pi for this software to function. To learn how to set that up, please refer to the [Asterisk FreePBX Setup Guide](Raspberry-Pi-Asterisk-FreePBX-Setup.md).

## Warning

This code was thrown together in a few days so please excuse the mess. This is not how I would normally write code, but it worked for my extremely tight deadline. This code is not maintained and I have no plans to update it in the future. This is only designed to support one physical phone. I would reference some of the techniques used here, but I would not recommend using this code as a template for your own projects. It is not designed to be scalable.

## Key Areas
- `src/MediaSessions.ts`: Handles streaming audio to and from the phone using the Asterisk API.
- `src/PhoneNetwork.ts`: Interface for the characters to register their phone numbers. Manages routing to characters and handles phone events.
- `src/characterInterfaces/Character.ts`: Logic that takes in configurations for the character, registers the character with the phone network and handles the audio in and out.
- `src/CharacterService.ts`: Initalizes all of the characters with prompts, phone numbers and special functions.

## Setup Raspberry Pi (Development)
1. Install Raspberry Pi OS on your Raspberry Pi.
2. Open a terminal and run the following commands to update the system:
   ```bash
   sudo apt update
   sudo apt upgrade
   ```
3. Setup SSH in the configs
  - Open the Terminal
  - Run `sudo raspi-config`
  - Navigate to `Interfacing Options`
  - Select `SSH` and enable it
  - Change the password for the `pi` user to something secure
  - Optional - Update the hostname to something more recognizable
  - When finished, you will be prompted to reboot the Raspberry Pi - Do it
4. In the terminal find the IP address of your Raspberry Pi:
   ```bash
   hostname -I
   ```
   - It should be the IP address that starts with 192.168.x.x
5. SSH from your development computer into the Raspberry Pi:
   ```bash
   ssh pi@<your-raspberry-pi-ip>
   ```
6. Install Git
   ```bash
   sudo apt install git
   ```
7. Login to Github and clone this repository

### Local Development
1. Run `yarn install`
2. Run `yarn start:dev`
