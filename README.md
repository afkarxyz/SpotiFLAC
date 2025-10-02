# SpotiFLAC - Enhanced Fork

[![GitHub All Releases](https://img.shields.io/github/downloads/afkarxyz/SpotiFLAC/total?style=for-the-badge)](https://github.com/afkarxyz/SpotiFLAC/releases)

![SpotiFLAC](https://github.com/user-attachments/assets/b4c4f403-edbd-4a71-b74b-c7d433d47d06)

<div align="center">
<b>SpotiFLAC</b> allows you to download Spotify tracks in true FLAC format through services like Qobuz, Tidal, Deezer & Amazon Music.
</div>

## 🚀 Enhanced Features (This Fork)

This is an enhanced fork of the original SpotiFLAC with the following improvements:

- ✅ **PySide6 Support**: Switched from PyQt6 to PySide6 for better Windows compatibility
- ✅ **Python 3.11 Compatible**: Optimized for Python 3.11 environment
- ✅ **Enhanced Download Management**: New "Remove Successful Downloads" feature
- ✅ **Improved Theme System**: Fixed theme functionality with better compatibility
- ✅ **Requirements File**: Added `requirements.txt` for easy dependency management
- ✅ **Better Error Handling**: Improved DLL loading and Qt library compatibility

## 📋 Requirements

- **Python**: 3.11+ (recommended)
- **Operating System**: Windows 10/11
- **Dependencies**: See `requirements.txt`

## 🛠️ Installation

### Method 1: Using Requirements File (Recommended)

1. Clone this repository:
```bash
git clone https://github.com/YOUR_USERNAME/SpotiFLAC.git
cd SpotiFLAC
```

2. Create a virtual environment:
```bash
python -m venv venv
venv\Scripts\activate  # Windows
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Run the application:
```bash
python SpotiFLAC.py
```

### Method 2: Manual Installation

```bash
pip install requests>=2.31 mutagen>=1.47 pyotp>=2.9.0 packaging>=23.0
pip install pyqtdarktheme>=2.0,<3
pip install PySide6>=6.6,<7
```

## 🎯 New Features

### Remove Successful Downloads
After a download completes, you can now:
1. Click "Remove Successful Downloads" on the Process tab
2. All successfully downloaded tracks are automatically removed from the list
3. No need to manually select and remove tracks

### Enhanced Theme System
- Fixed theme color changes
- Better compatibility with different qdarktheme versions
- Improved dark theme application

### Better Compatibility
- PySide6 instead of PyQt6 for better Windows support
- Resolved DLL loading issues
- Improved Qt library compatibility

## 📸 Screenshots

![image](https://github.com/user-attachments/assets/180b8322-ce2d-4842-a5dd-ac4d7b7a5efa)

![image](https://github.com/user-attachments/assets/3f84d53b-2da1-4488-986c-772b82832f2d)

![image](https://github.com/user-attachments/assets/f604dc04-4ee6-4084-b314-0be7cd5d7ef9)

![image](https://github.com/user-attachments/assets/40264f32-f2cf-4e91-b09d-fb628d9771f7)

## 🔍 Lossless Audio Check

![image](https://github.com/user-attachments/assets/d63b422d-0ea3-4307-850f-96c99d7eaa9a)

![image](https://github.com/user-attachments/assets/7649e6e1-d2d1-49b3-b83f-965d44651d05)

#### [Download](https://github.com/afkarxyz/SpotiFLAC/releases/download/v0/FLAC-Checker.zip) FLAC Checker

## 🐛 Troubleshooting

### Common Issues

**DLL Load Failed Error:**
```bash
pip uninstall PySide6 -y
pip install PySide6==6.5.3
```

**Theme Not Working:**
- Make sure `pyqtdarktheme` is installed: `pip install pyqtdarktheme`
- Try restarting the application

**Python Version Issues:**
- Ensure you're using Python 3.11+
- Use a virtual environment to avoid conflicts

## 📝 Original Project

This is a fork of the original [SpotiFLAC](https://github.com/afkarxyz/SpotiFLAC) project with enhancements for better compatibility and user experience.

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

This project maintains the same license as the original SpotiFLAC project.

---

**Note**: This fork is maintained independently and may have different features or compatibility requirements than the original project.